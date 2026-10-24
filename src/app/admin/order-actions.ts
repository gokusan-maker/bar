"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentRole, requireAdmin, requireStaff } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { repository } from "@/lib/container";
import type { OrderStatus } from "@/lib/domain/types";
import { newTableToken } from "@/lib/order-service";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function go(path: string, params: Record<string, string> = {}): never {
  const q = new URLSearchParams(params).toString();
  revalidatePath("/admin", "layout");
  redirect(q ? `${path}?${q}` : path);
}

/** 提供済み・取消・未提供に戻す（スタッフもできる） */
export async function setOrderStatusAction(formData: FormData) {
  await requireStaff();
  const status = str(formData, "status") as OrderStatus;
  if (!["new", "served", "cancelled"].includes(status)) throw new Error(`unknown status: ${status}`);
  const order = await repository().updateOrder(str(formData, "id"), { status });
  if (status === "cancelled") {
    await recordAudit({
      actor: (await currentRole()) ?? "staff",
      action: "注文を取消",
      targetType: "order",
      targetId: order.id,
      detail: `${order.tableName} ${order.lines.map((l) => `${l.name}×${l.qty}`).join("、")}`,
    });
  }
  go("/admin/orders");
}

export async function toggleOrderingAction(formData: FormData) {
  await requireAdmin();
  const repo = repository();
  const settings = await repo.getSettings();
  const enabled = str(formData, "enabled") === "1";
  await repo.saveSettings({ ...settings, orderingEnabled: enabled });
  await recordAudit({ actor: "owner", action: enabled ? "注文の受付を開始" : "注文の受付を停止", targetType: "settings", targetId: null, detail: null });
  go("/admin/menu", { saved: "1" });
}

export async function saveMenuItemAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 40);
  const price = Number(str(formData, "price").normalize("NFKC").replace(/[,，円¥￥]/g, ""));
  if (!name) go("/admin/menu", { error: "品名を入力してください" });
  if (!Number.isInteger(price) || price < 0) go("/admin/menu", { error: "値段は0以上の整数（円）で入力してください" });
  const input = {
    name,
    category: str(formData, "category").slice(0, 20),
    price,
    available: id ? formData.get("available") === "on" : true,
    sortOrder: Number.parseInt(str(formData, "sortOrder"), 10) || 0,
  };
  const repo = repository();
  if (id) await repo.updateMenuItem(id, input);
  else await repo.createMenuItem(input);
  go("/admin/menu", { saved: "1" });
}

export async function deleteMenuItemAction(formData: FormData) {
  await requireAdmin();
  // 過去の注文は品名と値段を持っているので、メニューを消しても残る
  await repository().deleteMenuItem(str(formData, "id"));
  go("/admin/menu", { saved: "1" });
}

export async function saveOrderTableAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 30);
  if (!name) go("/admin/menu", { error: "席の名前を入力してください" });
  const repo = repository();
  if (id) await repo.updateOrderTable(id, { name, active: formData.get("active") === "on" });
  else await repo.createOrderTable({ name, token: newTableToken(), active: true });
  go("/admin/menu", { saved: "1" });
}

/** QRコードを作り直す（古いQRコードは使えなくなる） */
export async function renewTableTokenAction(formData: FormData) {
  await requireAdmin();
  const table = await repository().updateOrderTable(str(formData, "id"), { token: newTableToken() });
  await recordAudit({ actor: "owner", action: "注文用QRコードを作り直し", targetType: "settings", targetId: table.id, detail: table.name });
  go("/admin/menu", { saved: "qr" });
}
