"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentActor, requireStaff } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { repository } from "@/lib/container";
import { parseBirthday, parsePhone, parseTags } from "@/lib/domain/customers";
import type { Channel } from "@/lib/domain/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const CHANNELS: Channel[] = ["line", "instagram", "x", "web", "manual"];

function go(path: string, params: Record<string, string> = {}): never {
  const q = new URLSearchParams(params).toString();
  revalidatePath("/admin", "layout");
  redirect(q ? `${path}?${q}` : path);
}

/** 名前・電話・誕生日・タグ・メモを読み取る。間違いがあれば error */
function readProfile(formData: FormData) {
  const phoneInput = str(formData, "phone");
  const birthdayInput = str(formData, "birthday");
  const phone = phoneInput ? parsePhone(phoneInput) : null;
  const birthday = birthdayInput ? parseBirthday(birthdayInput) : null;
  const error =
    phoneInput && !phone
      ? "電話番号は 090-1234-5678 のように入力してください"
      : birthdayInput && !birthday
        ? "誕生日は 5/3 のように月と日を入力してください"
        : null;
  return {
    error,
    profile: {
      name: str(formData, "name").slice(0, 40) || null,
      phone,
      birthday,
      tags: parseTags(str(formData, "tags")),
      note: str(formData, "note").slice(0, 1000) || null,
    },
  };
}

/** お店で直接お客様を登録する（電話予約・来店・紹介など） */
export async function createCustomerAction(formData: FormData) {
  await requireStaff();
  const { error, profile } = readProfile(formData);
  const back = (e: string) => go("/admin/customers/new", { error: e });
  if (error) back(error);
  if (!profile.name) back("お名前を入力してください");
  const repo = repository();
  if (profile.phone) {
    const same = (await repo.listCustomers({ search: profile.phone, limit: 5 })).find((c) => c.phone === profile.phone);
    if (same && formData.get("allowDuplicate") !== "on") {
      back(`同じ電話番号のお客様（${same.name ?? same.displayName ?? "名前未設定"}）がいます。同じ方ならそちらを編集してください。別の方なら「同じ電話番号のお客様がいても登録する」にチェックしてください`);
    }
  }
  const channel = str(formData, "channel") as Channel;
  const customer = await repo.createCustomer({
    ...profile,
    channel: CHANNELS.includes(channel) ? channel : "manual",
    staffId: str(formData, "staffId") || null,
  });
  const { actor, name } = await currentActor();
  await recordAudit({ actor, action: "お客様を登録", targetType: "customer", targetId: customer.id, detail: name ? `${customer.name}［${name}］` : customer.name });
  go(`/admin/customers/${customer.id}`, { saved: "1" });
}

export async function saveCustomerProfileAction(formData: FormData) {
  await requireStaff();
  const id = str(formData, "customerId");
  const { error, profile } = readProfile(formData);
  if (error) go(`/admin/customers/${id}`, { error });
  await repository().updateCustomer(id, profile);
  go(`/admin/customers/${id}`, { saved: "1" });
}
