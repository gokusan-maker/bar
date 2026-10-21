"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { repository, salesService } from "@/lib/container";
import { saleTotal } from "@/lib/domain/sales";
import type { AuditLog, Channel } from "@/lib/domain/types";
import { validateBackRates, type SaleInput } from "@/lib/sales-service";
import { hashPassword } from "@/lib/password";
import { newInviteCode, normalizeStaffName, passwordProblem } from "@/lib/staff-accounts";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
/** "6,000" や "６０００" も受け付ける。空欄は0 */
const yenField = (f: FormData, k: string) => {
  const v = str(f, k).normalize("NFKC").replace(/[,¥円\s]/g, "");
  return v === "" ? 0 : Number(v);
};
const CHANNELS: Channel[] = ["line", "instagram", "x", "web", "simulator", "manual"];

function go(path: string, params: Record<string, string> = {}): never {
  const q = new URLSearchParams(params).toString();
  revalidatePath("/admin", "layout");
  redirect(q ? `${path}?${q}` : path);
}

async function audit(action: string, targetType: AuditLog["targetType"], targetId: string | null, detail: string | null = null) {
  await recordAudit({ actor: "owner", action, targetType, targetId, detail });
}

function filesFrom(formData: FormData): File[] {
  return formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
}

/** 添付をまとめて保存し、失敗したものの理由を返す */
async function saveFiles(saleId: string, files: File[]): Promise<string[]> {
  const errors: string[] = [];
  for (const file of files) {
    const result = await salesService().addEvidence(saleId, {
      name: file.name,
      type: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    });
    if (!result.ok) errors.push(`${file.name}: ${result.error}`);
    else await audit("証拠を添付", "sale", saleId, file.name);
  }
  return errors;
}

export async function saveSaleAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "id");
  const channel = str(formData, "channel") as Channel;
  const input: SaleInput = {
    businessDate: str(formData, "businessDate"),
    reservationId: str(formData, "reservationId") || null,
    customerId: str(formData, "customerId") || null,
    staffId: str(formData, "staffId") || null,
    channel: CHANNELS.includes(channel) ? channel : "manual",
    customerName: str(formData, "customerName") || null,
    partySize: Number(str(formData, "partySize")),
    drinkAmount: yenField(formData, "drinkAmount"),
    chargeAmount: yenField(formData, "chargeAmount"),
    serviceAmount: formData.get("serviceAuto") === "on" ? null : yenField(formData, "serviceAmount"),
    note: str(formData, "note") || null,
  };
  const service = salesService();
  const result = id ? await service.updateSale(id, input) : await service.createSale(input);
  if (!result.ok) {
    go(id ? `/admin/sales/${id}` : "/admin/sales/new", {
      error: result.error,
      ...(input.reservationId ? { reservationId: input.reservationId } : {}),
    });
  }
  await audit(
    id ? "売上を修正" : "売上を登録",
    "sale",
    result.value.id,
    `${result.value.businessDate} ${result.value.customerName ?? ""} 合計${saleTotal(result.value)}円`,
  );
  const errors = await saveFiles(result.value.id, filesFrom(formData));
  go(`/admin/sales/${result.value.id}`, errors.length ? { error: errors.join(" / ") } : { saved: "1" });
}

export async function deleteSaleAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "id");
  const sale = await repository().getSale(id);
  await repository().deleteSale(id);
  if (sale) await audit("売上を削除", "sale", id, `${sale.businessDate} ${sale.customerName ?? ""} 合計${saleTotal(sale)}円`);
  go("/admin/sales", sale ? { month: sale.businessDate.slice(0, 7), deleted: "1" } : {});
}

export async function uploadEvidenceAction(formData: FormData) {
  await requireAdmin();
  const saleId = str(formData, "saleId");
  const errors = await saveFiles(saleId, filesFrom(formData));
  go(`/admin/sales/${saleId}`, errors.length ? { error: errors.join(" / ") } : { saved: "1" });
}

export async function deleteAttachmentAction(formData: FormData) {
  await requireAdmin();
  const attachmentId = str(formData, "attachmentId");
  const saleId = str(formData, "saleId");
  // 履歴用のファイル名はメタ情報から取る（本体はダウンロードしない）
  const meta = (await repository().listAttachments(saleId)).find((a) => a.id === attachmentId);
  await repository().deleteAttachment(attachmentId);
  await audit("証拠を削除", "sale", saleId, meta?.fileName ?? null);
  go(`/admin/sales/${str(formData, "saleId")}`, { saved: "1" });
}

export async function saveStaffAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "id");
  const name = str(formData, "name");
  const pct = (k: string) => Number(str(formData, k).normalize("NFKC") || "0");
  const backRates = {
    drink: pct("drink"),
    charge: pct("charge"),
    service: pct("service"),
    perVisit: yenField(formData, "perVisit"),
  };
  if (!name) go("/admin/staff", { error: "名前を入力してください" });
  const invalid = validateBackRates(backRates);
  if (invalid) go("/admin/staff", { error: invalid });
  const repo = repository();
  const rates = `お酒${backRates.drink}% 料金${backRates.charge}% サービス料${backRates.service}% 固定${backRates.perVisit}円`;
  // 店主がログイン用パスワードを決める場合（空なら変えない）
  const password = String(formData.get("password") ?? "");
  const disableLogin = formData.get("disableLogin") === "on";
  if (password) {
    const problem = passwordProblem(password);
    if (problem) go("/admin/staff", { error: problem });
    const key = normalizeStaffName(name);
    const clash = (await repo.listStaff()).some((s) => s.id !== id && (s.passwordHash || s.pending) && normalizeStaffName(s.name) === key);
    if (clash) go("/admin/staff", { error: `「${name}」はほかのスタッフがログインに使っています。名前を変えてください` });
  }
  const login = disableLogin
    ? { passwordHash: null, pending: false }
    : password
      ? { passwordHash: hashPassword(password), pending: false }
      : {};
  const loginNote = disableLogin ? "（ログインを止めた）" : password ? "（パスワードを設定）" : "";
  if (id) {
    await repo.updateStaff(id, { name, backRates, active: formData.get("active") === "on", ...login });
    await audit("スタッフを更新", "staff", id, `${name} ${rates}${loginNote}`);
  } else {
    const created = await repo.createStaff({ name, backRates, active: true, passwordHash: null, pending: false, ...login });
    await audit("スタッフを追加", "staff", created.id, `${name} ${rates}${loginNote}`);
  }
  go("/admin/staff", { saved: "1" });
}

/** 招待リンクからの登録申請を承認・却下する */
export async function reviewStaffAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "id");
  const repo = repository();
  const s = await repo.getStaff(id);
  if (!s?.pending) go("/admin/staff");
  if (str(formData, "op") === "approve") {
    await repo.updateStaff(id, { pending: false, active: true });
    await audit("スタッフ登録を承認", "staff", id, s.name);
    go("/admin/staff", { saved: "approved" });
  }
  // 却下：パスワードを消す。バック率が未設定（申請で新しく作られた）なら在籍も外して選択肢に出さない
  const unset = Object.values(s.backRates).every((v) => v === 0);
  await repo.updateStaff(id, { pending: false, passwordHash: null, ...(unset ? { active: false } : {}) });
  await audit("スタッフ登録を却下", "staff", id, s.name);
  go("/admin/staff", { saved: "rejected" });
}

/** 招待リンクを作る・作り直す・止める */
export async function staffInviteAction(formData: FormData) {
  await requireAdmin();
  const repo = repository();
  const settings = await repo.getSettings();
  const stop = str(formData, "op") === "stop";
  await repo.saveSettings({ ...settings, staffInviteCode: stop ? "" : newInviteCode() });
  await audit(stop ? "スタッフ招待リンクを停止" : "スタッフ招待リンクを発行", "settings", null);
  go("/admin/staff", { saved: stop ? "invite-stopped" : "invite" });
}

export async function setCustomerStaffAction(formData: FormData) {
  await requireAdmin();
  const customerId = str(formData, "customerId");
  await repository().updateCustomer(customerId, { staffId: str(formData, "staffId") || null });
  go(`/admin/customers/${customerId}`, { saved: "1" });
}
