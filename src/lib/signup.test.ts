import { describe, expect, it } from "vitest";
import { MemoryDirectory } from "./directory";
import { signupShop } from "./signup";

describe("owner signup", () => {
  it("creates a shop with its own settings and owner, separate from other shops", async () => {
    const dir = new MemoryDirectory();
    const repoFor = (id: string) => dir.repoFor(id);
    const r = await signupShop(dir, repoFor, { shopName: "Bar Moon", slug: "moon", ownerName: "月野", loginId: "Moon", password: "password1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shop.slug).toBe("moon");
    expect(r.owner).toMatchObject({ role: "owner", loginId: "moon", name: "月野" });
    expect((await repoFor(r.shop.id).getSettings()).shopName).toBe("Bar Moon");
    // オーナーはスタッフ一覧（バックの対象）に出ない
    expect(await repoFor(r.shop.id).listStaff()).toHaveLength(0);
    expect(await repoFor(r.shop.id).listOwners()).toHaveLength(1);
    expect((await dir.findMemberByLoginId("moon"))?.shopId).toBe(r.shop.id);

    // ほかの店舗のデータは見えない
    const other = await signupShop(dir, repoFor, { shopName: "Bar Sun", slug: "", ownerName: "太陽", loginId: "sun", password: "password1" });
    expect(other.ok && other.shop.slug).toMatch(/^s[0-9a-f]{8}$/);
    if (!other.ok) return;
    await repoFor(r.shop.id).createCustomer({ channel: "manual", name: "山田", phone: null, birthday: null, tags: [], note: null, staffId: null });
    expect(await repoFor(other.shop.id).listCustomers({ limit: 10 })).toHaveLength(0);
  });

  it("rejects duplicate URL names and login IDs, and bad input", async () => {
    const dir = new MemoryDirectory();
    const repoFor = (id: string) => dir.repoFor(id);
    const base = { shopName: "A", ownerName: "a", password: "password1" };
    expect((await signupShop(dir, repoFor, { ...base, slug: "shop1", loginId: "aaa" })).ok).toBe(false); // 店舗1が使っている
    expect((await signupShop(dir, repoFor, { ...base, slug: "a", loginId: "aaa" })).ok).toBe(false); // 短すぎる
    expect((await signupShop(dir, repoFor, { ...base, slug: "bar-a", loginId: "admin" }, ["admin"])).ok).toBe(false);
    expect((await signupShop(dir, repoFor, { ...base, slug: "bar-a", loginId: "aaa", password: "short" })).ok).toBe(false);
    expect((await signupShop(dir, repoFor, { ...base, slug: "bar-a", loginId: "aaa" })).ok).toBe(true);
    expect((await signupShop(dir, repoFor, { ...base, slug: "bar-b", loginId: "AAA" })).ok).toBe(false);
  });
});
