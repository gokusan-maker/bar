import { randomBytes } from "node:crypto";
import { addDays, fromJst, toJst } from "./domain/time";
import type { Order, OrderLine } from "./domain/types";
import type { Repository } from "./repo/types";

/** 1品あたりの最大数・1回の注文の最大品目数 */
export const MAX_QTY = 20;
export const MAX_LINES = 30;
/** いたずら対策：1つの席から10分間に受け付ける注文の数 */
export const MAX_ORDERS_PER_10MIN = 10;

export const newTableToken = () => randomBytes(12).toString("base64url");

/** 営業日の始まり（朝6時より前は前日の営業日） */
export function businessDayStart(now = new Date()): Date {
  const p = toJst(now);
  return fromJst(p.time < "06:00" ? addDays(p.date, -1) : p.date, "06:00");
}

export const orderTotal = (lines: Pick<OrderLine, "price" | "qty">[]) => lines.reduce((n, l) => n + l.price * l.qty, 0);

export type PlaceOrderResult = { ok: true; order: Order } | { ok: false; error: string };

/** お客様の注文を受け付ける。値段と商品名は必ずサーバー側のメニューから取る */
export async function placeOrder(
  repo: Repository,
  input: { token: string; items: { menuItemId: string; qty: number }[]; note: string },
  now = new Date(),
): Promise<PlaceOrderResult> {
  const settings = await repo.getSettings();
  if (!settings.orderingEnabled) return { ok: false, error: "ただいま注文を受け付けていません。スタッフにお声がけください" };
  const table = await repo.getOrderTableByToken(input.token);
  if (!table || !table.active) return { ok: false, error: "このQRコードは使えません。スタッフにお声がけください" };

  const menu = new Map((await repo.listMenu()).map((m) => [m.id, m]));
  const qtyById = new Map<string, number>();
  for (const item of input.items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0) continue;
    qtyById.set(item.menuItemId, (qtyById.get(item.menuItemId) ?? 0) + item.qty);
  }
  if (!qtyById.size) return { ok: false, error: "注文する品を選んでください" };
  if (qtyById.size > MAX_LINES) return { ok: false, error: `一度に注文できるのは${MAX_LINES}品目までです` };
  const lines: OrderLine[] = [];
  for (const [id, qty] of qtyById) {
    const m = menu.get(id);
    if (!m || !m.available) return { ok: false, error: "品切れの品があります。メニューを確認してください" };
    if (qty > MAX_QTY) return { ok: false, error: `1品につき${MAX_QTY}個までです` };
    lines.push({ menuItemId: m.id, name: m.name, price: m.price, qty });
  }

  const recent = await repo.listOrders({ tableId: table.id, since: new Date(now.getTime() - 10 * 60 * 1000), limit: MAX_ORDERS_PER_10MIN });
  if (recent.length >= MAX_ORDERS_PER_10MIN) return { ok: false, error: "注文が続いています。少し時間をおいてお試しください" };

  const note = input.note.trim().slice(0, 200) || null;
  const order = await repo.createOrder({ tableId: table.id, tableName: table.name, lines, total: orderTotal(lines), note });
  return { ok: true, order };
}

/** 売上に取り込む注文の合計と、売上のメモに書く内訳 */
export function summarizeForSale(orders: Order[]): { total: number; note: string } {
  const live = orders.filter((o) => o.status !== "cancelled" && !o.saleId);
  const counts = new Map<string, number>();
  for (const o of live) for (const l of o.lines) counts.set(l.name, (counts.get(l.name) ?? 0) + l.qty);
  return {
    total: live.reduce((n, o) => n + o.total, 0),
    note: [...counts].map(([name, qty]) => `${name}×${qty}`).join("、"),
  };
}
