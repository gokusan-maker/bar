"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { promoService, repository } from "@/lib/container";
import { sniffContentType } from "@/lib/sales-service";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function go(params: Record<string, string>): never {
  revalidatePath("/admin/post");
  redirect(`/admin/post?${new URLSearchParams(params)}`);
}

export async function savePromoSettingsAction(formData: FormData) {
  await requireAdmin();
  const repo = repository();
  const current = await repo.getSettings();
  const enabled = formData.get("promoEnabled") === "on";
  await repo.saveSettings({
    ...current,
    promoEnabled: enabled,
    promoTime: str(formData, "promoTime") === "noon" ? "noon" : "evening",
    promoWeekdays: formData
      .getAll("promoWeekdays")
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    promoMessage: str(formData, "promoMessage").slice(0, 300),
    promoInstagram: formData.get("promoInstagram") === "on",
  });
  if (enabled !== current.promoEnabled) {
    await recordAudit({ actor: "owner", action: enabled ? "集客の自動配信をオン" : "集客の自動配信をオフ", targetType: "settings", targetId: null, detail: null });
  }
  go({ saved: "1" });
}

export async function saveBirthdaySettingsAction(formData: FormData) {
  await requireAdmin();
  const repo = repository();
  const current = await repo.getSettings();
  const enabled = formData.get("birthdayGreetingEnabled") === "on";
  const message = str(formData, "birthdayMessage").slice(0, 500);
  if (enabled && !message) go({ error: "お祝いの文を入力してください" });
  await repo.saveSettings({ ...current, birthdayGreetingEnabled: enabled, birthdayMessage: message });
  go({ saved: "1" });
}

/** Instagram投稿用の画像（InstagramのAPIはJPEGのみ） */
export async function uploadPromoImageAction(formData: FormData) {
  await requireAdmin();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) go({ error: "画像を選んでください" });
  if (file.size > 4 * 1024 * 1024) go({ error: "画像は4MBまでです" });
  const data = new Uint8Array(await file.arrayBuffer());
  if (sniffContentType(data) !== "image/jpeg") go({ error: "JPEG形式の画像を選んでください（InstagramはJPEGのみ投稿できます）" });
  const repo = repository();
  const key = randomBytes(12).toString("base64url");
  await repo.savePromoImage(key, data, "image/jpeg");
  await repo.saveSettings({ ...(await repo.getSettings()), promoImageKey: key });
  go({ saved: "image" });
}

export async function sendPromoNowAction(formData: FormData) {
  await requireAdmin();
  if (formData.get("confirm") !== "on") go({ error: "「友だち全員に送る」にチェックを入れてください" });
  const result = await promoService().sendNow();
  if (!result.sent) go({ error: result.reason ?? "配信できませんでした" });
  const where = [result.line && "LINE", result.instagram && "Instagram"].filter(Boolean).join("・");
  go({ sent: where, ...(result.reason ? { error: result.reason } : {}) });
}
