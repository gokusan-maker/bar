import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "./repo/memory";
import { businessDayStart, MAX_ORDERS_PER_10MIN, newTableToken, placeOrder, summarizeForSale } from "./order-service";

describe("QR ordering", () => {
  let repo: MemoryRepository;
  let token: string;
  let beer: string;
  let soldOut: string;

  beforeEach(async () => {
    repo = new MemoryRepository();
    token = newTableToken();
    await repo.createOrderTable({ name: "カウンター1", token, active: true });
    beer = (await repo.createMenuItem({ name: "生ビール", category: "ビール", price: 800, available: true, sortOrder: 0 })).id;
    soldOut = (await repo.createMenuItem({ name: "限定酒", category: "日本酒", price: 1500, available: false, sortOrder: 1 })).id;
  });

  it("prices the order from the menu, not from the guest", async () => {
    const r = await placeOrder(repo, { token, items: [{ menuItemId: beer, qty: 2 }, { menuItemId: beer, qty: 1 }], note: " 氷少なめ " });
    expect(r).toMatchObject({ ok: true, order: { tableName: "カウンター1", total: 2400, note: "氷少なめ", status: "new" } });
    if (r.ok) expect(r.order.lines).toEqual([{ menuItemId: beer, name: "生ビール", price: 800, qty: 3 }]);
  });

  it("rejects unknown tables, sold-out items, empty and oversized orders, and when ordering is off", async () => {
    expect((await placeOrder(repo, { token: "nope", items: [{ menuItemId: beer, qty: 1 }], note: "" })).ok).toBe(false);
    expect((await placeOrder(repo, { token, items: [{ menuItemId: soldOut, qty: 1 }], note: "" })).ok).toBe(false);
    expect((await placeOrder(repo, { token, items: [{ menuItemId: beer, qty: 0 }], note: "" })).ok).toBe(false);
    expect((await placeOrder(repo, { token, items: [{ menuItemId: beer, qty: 21 }], note: "" })).ok).toBe(false);
    await repo.saveSettings({ ...(await repo.getSettings()), orderingEnabled: false });
    expect((await placeOrder(repo, { token, items: [{ menuItemId: beer, qty: 1 }], note: "" })).ok).toBe(false);
  });

  it("stops a flood of orders from one table", async () => {
    for (let i = 0; i < MAX_ORDERS_PER_10MIN; i++) {
      expect((await placeOrder(repo, { token, items: [{ menuItemId: beer, qty: 1 }], note: "" })).ok).toBe(true);
    }
    expect((await placeOrder(repo, { token, items: [{ menuItemId: beer, qty: 1 }], note: "" })).ok).toBe(false);
  });

  it("summarizes open orders for a sale, skipping cancelled and already imported ones", async () => {
    const a = await placeOrder(repo, { token, items: [{ menuItemId: beer, qty: 2 }], note: "" });
    const b = await placeOrder(repo, { token, items: [{ menuItemId: beer, qty: 1 }], note: "" });
    if (!a.ok || !b.ok) throw new Error("setup");
    const cancelled = await repo.updateOrder(b.order.id, { status: "cancelled" });
    expect(summarizeForSale([a.order, cancelled])).toEqual({ total: 1600, note: "生ビール×2" });
    expect(summarizeForSale([{ ...a.order, saleId: "s1" }]).total).toBe(0);
  });

  it("starts the business day at 6am JST", () => {
    expect(businessDayStart(new Date("2026-10-24T17:00:00Z")).toISOString()).toBe("2026-10-23T21:00:00.000Z"); // 25日2時 → 24日6時
    expect(businessDayStart(new Date("2026-10-24T12:00:00Z")).toISOString()).toBe("2026-10-23T21:00:00.000Z"); // 24日21時
  });
});
