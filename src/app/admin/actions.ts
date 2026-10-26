"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentRole, logout, requireAdmin, requireStaff } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { currentShopId, directory, repository, reservationService } from "@/lib/container";
import { isValidSlug } from "@/lib/directory";
import { isThemeKey } from "@/lib/domain/theme";
import { loginIdProblem, normalizeLoginId } from "@/lib/staff-accounts";
import type { ShopSecrets, ShopSettings } from "@/lib/domain/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const int = (f: FormData, k: string) => Number.parseInt(str(f, k), 10);

function back(path: string, params: Record<string, string> = {}): never {
  const q = new URLSearchParams(params).toString();
  revalidatePath("/admin", "layout");
  redirect(q ? `${path}?${q}` : path);
}

export async function reservationAction(formData: FormData) {
  const id = str(formData, "id");
  const op = str(formData, "op");
  // スタッフは来店チェックだけできる
  if (op === "visited" || op === "no_show") await requireStaff();
  else await requireAdmin();
  const service = reservationService();
  switch (op) {
    case "approve":
      await service.approve(id);
      break;
    case "reject":
      await service.reject(id);
      break;
    case "cancel":
      await service.cancelByShop(id, formData.get("notify") === "on");
      break;
    case "visited":
    case "no_show":
      await service.markVisit(id, op === "visited", (await currentRole()) ?? "staff");
      break;
    case "resync":
      await service.resync(id);
      break;
    default:
      throw new Error(`unknown op: ${op}`);
  }
  back(str(formData, "return") || `/admin/reservations/${id}`, { done: op });
}

export async function createManualAction(formData: FormData) {
  await requireAdmin();
  const input = {
    date: str(formData, "date"),
    time: str(formData, "time"),
    partySize: int(formData, "partySize"),
    name: str(formData, "name"),
    notes: str(formData, "notes") || null,
    force: formData.get("force") === "on",
  };
  if (!input.name) back("/admin/new", { error: "お名前を入力してください", ...stringify(input) });
  const result = await reservationService().createManual(input);
  if (!result.ok) back("/admin/new", { error: result.error, ...stringify(input) });
  back(`/admin/reservations/${result.reservation.id}`, { done: "created" });
}

function stringify(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "boolean")
      .map(([k, v]) => [k, String(v)]),
  );
}

export async function editReservationAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "id");
  const input = {
    date: str(formData, "date"),
    time: str(formData, "time"),
    partySize: int(formData, "partySize"),
    name: str(formData, "name"),
    notes: str(formData, "notes") || null,
    force: formData.get("force") === "on",
    notifyCustomer: formData.get("notify") === "on",
  };
  if (!input.name) back(`/admin/reservations/${id}`, { error: "お名前を入力してください" });
  const result = await reservationService().editByShop(id, input);
  if (!result.ok) back(`/admin/reservations/${id}`, { error: result.error });
  back(`/admin/reservations/${id}`, { done: "edit" });
}

export async function saveSettingsAction(formData: FormData) {
  await requireAdmin();
  const repo = repository();
  const current = await repo.getSettings();
  const numberField = (k: keyof ShopSettings, min: number) => {
    const v = int(formData, k);
    return Number.isFinite(v) && v >= min ? v : (current[k] as number);
  };
  const clock = (k: "openTime" | "closeTime") => {
    const v = str(formData, k);
    return /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, "0") : current[k];
  };
  // 席エリアは「名前・席数」の行の繰り返し。空行は無視する
  const names = formData.getAll("areaName").map((v) => String(v).trim());
  const seats = formData.getAll("areaSeats").map((v) => Number.parseInt(String(v), 10));
  const seatAreas = names
    .map((name, i) => ({ name, seats: seats[i] }))
    .filter((a) => a.name && Number.isInteger(a.seats) && a.seats > 0);
  if (!seatAreas.length) back("/admin/settings", { error: "席を1つ以上登録してください" });
  const backTarget = str(formData, "backTarget");
  const rate = Number(str(formData, "serviceChargeRate"));

  // この画面にない項目（注文・集客・招待リンクなど）はそのまま残す
  const settings: ShopSettings = {
    ...current,
    shopName: str(formData, "shopName") || current.shopName,
    shopType: str(formData, "shopType") || current.shopType,
    seatAreas,
    openTime: clock("openTime"),
    closeTime: clock("closeTime"),
    lastEntryMinutesBeforeClose: numberField("lastEntryMinutesBeforeClose", 0),
    closedWeekdays: formData.getAll("closedWeekdays").map((v) => Number(v)),
    closedDates: str(formData, "closedDates")
      .split(/[\s,、]+/)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    capacity: seatAreas.reduce((n, a) => n + a.seats, 0),
    maxPartySize: numberField("maxPartySize", 1),
    stayMinutes: numberField("stayMinutes", 15),
    autoConfirm: formData.get("autoConfirm") === "on",
    autoConfirmMaxParty: numberField("autoConfirmMaxParty", 1),
    minLeadMinutes: numberField("minLeadMinutes", 0),
    maxAdvanceDays: numberField("maxAdvanceDays", 1),
    blockOnCalendarEvents: formData.get("blockOnCalendarEvents") === "on",
    sendReminders: formData.get("sendReminders") === "on",
    manualMode: formData.get("manualMode") === "on",
    chargePerPerson: numberField("chargePerPerson", 0),
    serviceChargeRate: Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : current.serviceChargeRate,
    backTarget: backTarget === "all" ? "all" : "sns",
    retentionMonths: numberField("retentionMonths", 0),
    webBookingEnabled: formData.get("webBookingEnabled") === "on",
    themeColor: isThemeKey(str(formData, "themeColor")) ? str(formData, "themeColor") : current.themeColor,
    shopPhone: str(formData, "shopPhone").slice(0, 20),
    shopMessage: str(formData, "shopMessage").slice(0, 300),
    // LINEの公式URLだけを受け付ける（予約フォームにリンクとして出すため）
    lineFriendUrl: /^https:\/\/(lin\.ee|line\.me|page\.line\.me)\//.test(str(formData, "lineFriendUrl"))
      ? str(formData, "lineFriendUrl")
      : "",
  };
  await repo.saveSettings(settings);
  // 店舗の一覧（運営の画面・ログインの表示）の店名もそろえる
  if (settings.shopName !== current.shopName) await directory().updateShop(await currentShopId(), { name: settings.shopName });
  await recordAudit({ actor: "owner", action: "設定を変更", targetType: "settings", targetId: null, detail: null });
  back("/admin/settings", { saved: "1" });
}

/** このお店のLINE公式アカウント・Instagramの接続情報（暗号化して保存。空欄は今の値のまま） */
export async function saveSnsConnectionsAction(formData: FormData) {
  await requireAdmin();
  const repo = repository();
  const current = await repo.getSecrets();
  const next: ShopSecrets = { ...current };
  for (const key of ["lineChannelSecret", "lineChannelAccessToken", "instagramAccessToken", "instagramAppSecret", "instagramVerifyToken"] as const) {
    const value = str(formData, key);
    if (formData.get(`${key}Clear`) === "on") delete next[key];
    else if (value) next[key] = value.slice(0, 500);
  }
  await repo.saveSecrets(next);
  const notifyId = str(formData, "ownerNotifyLineUserId");
  if (notifyId && !/^U[0-9a-f]{32}$/.test(notifyId)) back("/admin/settings", { error: "店主への通知先は U で始まる33文字のユーザーIDを入れてください" });
  await repo.saveSettings({ ...(await repo.getSettings()), ownerNotifyLineUserId: notifyId });
  await recordAudit({ actor: "owner", action: "SNSの接続を変更", targetType: "integration", targetId: null, detail: null });
  back("/admin/settings", { saved: "1" });
}

/** お店のURL名（予約フォームなどのアドレス） */
export async function saveShopSlugAction(formData: FormData) {
  await requireAdmin();
  const slug = str(formData, "slug").toLowerCase();
  if (!isValidSlug(slug)) back("/admin/settings", { error: "URL名は2〜31文字の半角英小文字・数字・ハイフンにしてください" });
  const dir = directory();
  const shopId = await currentShopId();
  const other = await dir.getShopBySlug(slug);
  if (other && other.id !== shopId) back("/admin/settings", { error: "このURL名はすでに使われています" });
  await dir.updateShop(shopId, { slug });
  await recordAudit({ actor: "owner", action: "お店のURL名を変更", targetType: "settings", targetId: null, detail: slug });
  back("/admin/settings", { saved: "1" });
}

/** オーナーのログインID（パスワードは ADMIN_PASSWORD のまま） */
export async function saveOwnerLoginIdAction(formData: FormData) {
  await requireAdmin();
  const id = normalizeLoginId(str(formData, "ownerLoginId"));
  const problem = loginIdProblem(id);
  if (problem) back("/admin/settings", { error: problem });
  const repo = repository();
  if (await directory().findMemberByLoginId(id)) back("/admin/settings", { error: "このIDはスタッフが使っています" });
  await repo.saveSettings({ ...(await repo.getSettings()), ownerLoginId: id });
  await recordAudit({ actor: "owner", action: "オーナーのログインIDを変更", targetType: "settings", targetId: null, detail: id });
  back("/admin/settings", { saved: "1" });
}

/** オーナーのLINEログインの連携を外す（パスワードでのログインは残る） */
export async function unlinkOwnerLineAction() {
  await requireAdmin();
  const repo = repository();
  await repo.saveSettings({ ...(await repo.getSettings()), ownerLineUserIds: [] });
  await recordAudit({ actor: "owner", action: "店主のLINEログインの連携を解除", targetType: "settings", targetId: null, detail: null });
  back("/admin/settings", { line: "unlinked" });
}

export async function saveCalendarAction(formData: FormData) {
  await requireAdmin();
  const repo = repository();
  const integration = await repo.getGoogleIntegration();
  if (integration) {
    await repo.saveGoogleIntegration({ ...integration, calendarId: str(formData, "calendarId") || "primary" });
  }
  back("/admin/settings", { saved: "1" });
}

export async function pullCalendarAction() {
  await requireAdmin();
  const { moved, deleted, failed } = await reservationService().pullCalendarChanges();
  back("/admin/settings", { pulled: `${moved}-${deleted}-${failed}` });
}

export async function disconnectGoogleAction() {
  await requireAdmin();
  await repository().saveGoogleIntegration(null);
  await recordAudit({ actor: "owner", action: "Googleカレンダー連携を解除", targetType: "integration", targetId: null, detail: null });
  back("/admin/settings", { google: "disconnected" });
}

export async function manualReplyAction(formData: FormData) {
  await requireStaff();
  const customerId = str(formData, "customerId");
  const text = str(formData, "text");
  if (text) {
    try {
      await reservationService().sendManualReply(customerId, text);
    } catch (error) {
      back(`/admin/customers/${customerId}`, { error: `送信に失敗しました: ${(error as Error).message}` });
    }
  }
  back(`/admin/customers/${customerId}`);
}

export async function simulatorSendAction(formData: FormData) {
  await requireAdmin();
  const userId = str(formData, "userId") || "guest-1";
  const text = str(formData, "text");
  if (text) {
    await reservationService().handleIncoming({
      channel: "simulator",
      externalId: userId,
      displayName: `テスト客(${userId})`,
      text,
    });
  }
  back("/admin/simulator", { user: userId });
}

/** はじめの設定のチェックリストを閉じる */
export async function dismissSetupAction() {
  await requireAdmin();
  const repo = repository();
  await repo.saveSettings({ ...(await repo.getSettings()), setupDismissed: true });
  back("/admin");
}

export async function logoutAction() {
  const role = await currentRole();
  await logout();
  redirect(role === "owner" ? "/owner/login" : "/login");
}
