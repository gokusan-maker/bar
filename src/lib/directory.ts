/* eslint-disable @typescript-eslint/no-explicit-any -- 生成型を使わないためDB行は any で受けて変換する */
import { randomBytes } from "node:crypto";
import { DEFAULT_SHOP_ID, type Shop, type Staff } from "./domain/types";
import { MemoryRepository } from "./repo/memory";
import { supabaseClient, toStaff } from "./repo/supabase";

/** 店舗をまたいだ検索（ログイン、招待リンク、QRコード）と店舗の作成 */
export interface ShopDirectory {
  listShops(): Promise<Shop[]>;
  getShop(id: string): Promise<Shop | null>;
  getShopBySlug(slug: string): Promise<Shop | null>;
  createShop(input: { name: string; slug: string }): Promise<Shop>;
  updateShop(id: string, patch: Partial<Pick<Shop, "name" | "slug" | "active">>): Promise<Shop>;
  /** ログインID・LINEユーザーIDは全店舗で重複しない */
  findMemberByLoginId(loginId: string): Promise<{ shopId: string; member: Staff } | null>;
  findMemberByLineUserId(lineUserId: string): Promise<{ shopId: string; member: Staff } | null>;
  findShopIdByInviteCode(code: string): Promise<string | null>;
  findShopIdByTableToken(token: string): Promise<string | null>;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;
export const isValidSlug = (slug: string) => SLUG.test(slug);
export const randomSlug = () => `s${randomBytes(4).toString("hex")}`;

/** メモリ保存（開発・テスト用）。店舗ごとに MemoryRepository を持つ */
export class MemoryDirectory implements ShopDirectory {
  private shops = new Map<string, Shop>();
  readonly repos = new Map<string, MemoryRepository>();

  constructor(defaultRepo = new MemoryRepository()) {
    this.shops.set(DEFAULT_SHOP_ID, { id: DEFAULT_SHOP_ID, name: "店舗1", slug: "shop1", active: true, createdAt: new Date(0).toISOString() });
    this.repos.set(DEFAULT_SHOP_ID, defaultRepo);
  }

  repoFor(shopId: string): MemoryRepository {
    const repo = this.repos.get(shopId);
    if (!repo) throw new Error(`shop not found: ${shopId}`);
    return repo;
  }

  async listShops() {
    return [...this.shops.values()].map((s) => ({ ...s }));
  }
  async getShop(id: string) {
    const s = this.shops.get(id);
    return s ? { ...s } : null;
  }
  async getShopBySlug(slug: string) {
    const s = [...this.shops.values()].find((x) => x.slug === slug);
    return s ? { ...s } : null;
  }
  async createShop(input: { name: string; slug: string }) {
    if (await this.getShopBySlug(input.slug)) throw new Error("このURL名はすでに使われています");
    const shop: Shop = { id: crypto.randomUUID(), name: input.name, slug: input.slug, active: true, createdAt: new Date().toISOString() };
    this.shops.set(shop.id, shop);
    this.repos.set(shop.id, new MemoryRepository());
    return { ...shop };
  }
  async updateShop(id: string, patch: Partial<Pick<Shop, "name" | "slug" | "active">>) {
    const s = this.shops.get(id);
    if (!s) throw new Error(`shop not found: ${id}`);
    if (patch.slug && patch.slug !== s.slug && (await this.getShopBySlug(patch.slug))) throw new Error("このURL名はすでに使われています");
    Object.assign(s, patch);
    return { ...s };
  }
  private findMember(match: (m: Staff) => boolean) {
    for (const [shopId, repo] of this.repos) {
      const member = repo.allMembers().find(match);
      if (member) return { shopId, member };
    }
    return null;
  }
  async findMemberByLoginId(loginId: string) {
    return this.findMember((m) => m.loginId === loginId);
  }
  async findMemberByLineUserId(lineUserId: string) {
    return this.findMember((m) => m.lineUserId === lineUserId);
  }
  async findShopIdByInviteCode(code: string) {
    if (!code) return null;
    for (const [shopId, repo] of this.repos) if ((await repo.getSettings()).staffInviteCode === code) return shopId;
    return null;
  }
  async findShopIdByTableToken(token: string) {
    for (const [shopId, repo] of this.repos) if (repo.allOrderTables().some((t) => t.token === token)) return shopId;
    return null;
  }
}

const toShop = (r: { id: string; name: string; slug: string; active: boolean; created_at: string }): Shop => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  active: r.active,
  createdAt: r.created_at,
});

export class SupabaseDirectory implements ShopDirectory {
  private db: ReturnType<typeof supabaseClient>;

  constructor(url: string, serviceRoleKey: string) {
    this.db = supabaseClient(url, serviceRoleKey);
  }

  private check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
    if (res.error) throw new Error(res.error.code === "23505" ? "このURL名はすでに使われています" : `Supabase: ${res.error.message}`);
    return res.data;
  }

  async listShops() {
    return (this.check(await this.db.from("shops").select().order("created_at")) as any[]).map(toShop);
  }
  async getShop(id: string) {
    const row = this.check(await this.db.from("shops").select().eq("id", id).maybeSingle());
    return row ? toShop(row as any) : null;
  }
  async getShopBySlug(slug: string) {
    const row = this.check(await this.db.from("shops").select().eq("slug", slug).maybeSingle());
    return row ? toShop(row as any) : null;
  }
  async createShop(input: { name: string; slug: string }) {
    return toShop(this.check(await this.db.from("shops").insert({ name: input.name, slug: input.slug }).select().single()) as any);
  }
  async updateShop(id: string, patch: Partial<Pick<Shop, "name" | "slug" | "active">>) {
    return toShop(this.check(await this.db.from("shops").update(patch).eq("id", id).select().single()) as any);
  }
  async findMemberByLoginId(loginId: string) {
    const row: any = this.check(await this.db.from("staff").select().eq("login_id", loginId).maybeSingle());
    return row ? { shopId: row.shop_id as string, member: toStaff(row) } : null;
  }
  async findMemberByLineUserId(lineUserId: string) {
    const row: any = this.check(await this.db.from("staff").select().eq("line_user_id", lineUserId).maybeSingle());
    return row ? { shopId: row.shop_id as string, member: toStaff(row) } : null;
  }
  async findShopIdByInviteCode(code: string) {
    if (!code) return null;
    const row: any = this.check(await this.db.from("settings").select("shop_id").filter("data->>staffInviteCode", "eq", code).maybeSingle());
    return row?.shop_id ?? null;
  }
  async findShopIdByTableToken(token: string) {
    const row: any = this.check(await this.db.from("order_tables").select("shop_id").eq("token", token).maybeSingle());
    return row?.shop_id ?? null;
  }
}
