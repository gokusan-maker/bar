/* eslint-disable @typescript-eslint/no-explicit-any -- 生成型を使わないためDB行は any で受けて変換する */
import { randomBytes } from "node:crypto";
import { NO_BILLING } from "./domain/billing";
import { DEFAULT_SHOP_ID, type Shop, type ShopBilling, type Staff } from "./domain/types";
import { MemoryRepository } from "./repo/memory";
import { supabaseClient, toStaff } from "./repo/supabase";

/** 店舗をまたいだ検索（ログイン、招待リンク、QRコード）と店舗の作成 */
export interface ShopDirectory {
  listShops(): Promise<Shop[]>;
  getShop(id: string): Promise<Shop | null>;
  getShopBySlug(slug: string): Promise<Shop | null>;
  /** trialEndsAt を渡すと、その日まで無料期間 */
  createShop(input: { name: string; slug: string; trialEndsAt?: string | null }): Promise<Shop>;
  updateShop(id: string, patch: Partial<Pick<Shop, "name" | "slug" | "active">>): Promise<Shop>;
  updateBilling(id: string, patch: Partial<ShopBilling>): Promise<Shop>;
  findShopIdByStripeSubscription(subscriptionId: string): Promise<string | null>;
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
    this.shops.set(DEFAULT_SHOP_ID, {
      id: DEFAULT_SHOP_ID,
      name: "店舗1",
      slug: "shop1",
      active: true,
      createdAt: new Date(0).toISOString(),
      billing: { ...NO_BILLING },
    });
    this.repos.set(DEFAULT_SHOP_ID, defaultRepo);
  }

  repoFor(shopId: string): MemoryRepository {
    const repo = this.repos.get(shopId);
    if (!repo) throw new Error(`shop not found: ${shopId}`);
    return repo;
  }

  private copy = (s: Shop): Shop => ({ ...s, billing: { ...s.billing } });

  async listShops() {
    return [...this.shops.values()].map(this.copy);
  }
  async getShop(id: string) {
    const s = this.shops.get(id);
    return s ? this.copy(s) : null;
  }
  async getShopBySlug(slug: string) {
    const s = [...this.shops.values()].find((x) => x.slug === slug);
    return s ? this.copy(s) : null;
  }
  async createShop(input: { name: string; slug: string; trialEndsAt?: string | null }) {
    if (await this.getShopBySlug(input.slug)) throw new Error("このURL名はすでに使われています");
    const shop: Shop = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      active: true,
      createdAt: new Date().toISOString(),
      billing: { ...NO_BILLING, status: "trialing", exempt: false, trialEndsAt: input.trialEndsAt ?? null },
    };
    this.shops.set(shop.id, shop);
    this.repos.set(shop.id, new MemoryRepository());
    return { ...shop };
  }
  async updateShop(id: string, patch: Partial<Pick<Shop, "name" | "slug" | "active">>) {
    const s = this.shops.get(id);
    if (!s) throw new Error(`shop not found: ${id}`);
    if (patch.slug && patch.slug !== s.slug && (await this.getShopBySlug(patch.slug))) throw new Error("このURL名はすでに使われています");
    Object.assign(s, patch);
    return this.copy(s);
  }
  async updateBilling(id: string, patch: Partial<ShopBilling>) {
    const s = this.shops.get(id);
    if (!s) throw new Error(`shop not found: ${id}`);
    Object.assign(s.billing, patch);
    return this.copy(s);
  }
  async findShopIdByStripeSubscription(subscriptionId: string) {
    return [...this.shops.values()].find((s) => s.billing.stripeSubscriptionId === subscriptionId)?.id ?? null;
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

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

const toShop = (r: any): Shop => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  active: r.active,
  createdAt: r.created_at,
  billing: {
    status: r.billing_status ?? "active",
    trialEndsAt: iso(r.trial_ends_at),
    exempt: r.billing_exempt ?? false,
    stripeCustomerId: r.stripe_customer_id ?? null,
    stripeSubscriptionId: r.stripe_subscription_id ?? null,
    currentPeriodEnd: iso(r.current_period_end),
  },
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
  async createShop(input: { name: string; slug: string; trialEndsAt?: string | null }) {
    const row = { name: input.name, slug: input.slug, billing_status: "trialing", trial_ends_at: input.trialEndsAt ?? null };
    return toShop(this.check(await this.db.from("shops").insert(row).select().single()) as any);
  }
  async updateBilling(id: string, patch: Partial<ShopBilling>) {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.billing_status = patch.status;
    if (patch.trialEndsAt !== undefined) row.trial_ends_at = patch.trialEndsAt;
    if (patch.exempt !== undefined) row.billing_exempt = patch.exempt;
    if (patch.stripeCustomerId !== undefined) row.stripe_customer_id = patch.stripeCustomerId;
    if (patch.stripeSubscriptionId !== undefined) row.stripe_subscription_id = patch.stripeSubscriptionId;
    if (patch.currentPeriodEnd !== undefined) row.current_period_end = patch.currentPeriodEnd;
    return toShop(this.check(await this.db.from("shops").update(row).eq("id", id).select().single()) as any);
  }
  async findShopIdByStripeSubscription(subscriptionId: string) {
    const row: any = this.check(await this.db.from("shops").select("id").eq("stripe_subscription_id", subscriptionId).maybeSingle());
    return row?.id ?? null;
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
