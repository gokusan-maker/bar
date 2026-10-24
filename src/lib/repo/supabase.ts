import "server-only";
import { createClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "../crypto";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SETTINGS,
  type Attachment,
  type AuditLog,
  type Channel,
  type Customer,
  type Draft,
  type GoogleIntegration,
  type MessageLog,
  type Reservation,
  type Sale,
  type ShopSettings,
  type MenuItem,
  type Order,
  type OrderTable,
  type Staff,
} from "../domain/types";
import type {
  NewReservation,
  NewSale,
  PurgeResult,
  Repository,
  ReservationPatch,
  ReservationQuery,
  SalePatch,
  SaleQuery,
  CustomerPatch,
  NewStaff,
  OrderQuery,
} from "./types";

/** 1つのSupabaseプロジェクトに他のアプリと同居させるため、表は bar スキーマ、写真は bar-evidence バケットに置く */
export const DB_SCHEMA = "bar";
export const EVIDENCE_BUCKET = "bar-evidence";
const BUCKET = EVIDENCE_BUCKET;

export function supabaseClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, { db: { schema: DB_SCHEMA }, auth: { persistSession: false } });
}

/* eslint-disable @typescript-eslint/no-explicit-any -- 生成型を使わないためDB行は any で受けて変換する */

const toCustomer = (r: any): Customer => ({
  id: r.id,
  channel: r.channel,
  externalId: r.external_id,
  displayName: r.display_name,
  name: r.name,
  note: r.note,
  staffId: r.staff_id ?? null,
  phone: r.phone ?? null,
  birthday: r.birthday ?? null,
  tags: r.tags ?? [],
  birthdayGreetedYear: r.birthday_greeted_year ?? null,
  createdAt: r.created_at,
});

const toStaff = (r: any): Staff => ({
  id: r.id,
  name: r.name,
  backRates: {
    // 以前の項目別の率（お酒・料金・サービス料）で保存されたものは、お酒の率を全体の率として引き継ぐ
    rate: Number(r.back_rates?.rate ?? r.back_rates?.drink ?? 0),
    perVisit: Number(r.back_rates?.perVisit ?? 0),
  },
  active: r.active,
  passwordHash: r.password_hash ?? null,
  pending: r.pending ?? false,
  createdAt: r.created_at,
});

const toMenuItem = (r: any): MenuItem => ({
  id: r.id,
  name: r.name,
  category: r.category,
  price: r.price,
  available: r.available,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
});

const toOrderTable = (r: any): OrderTable => ({
  id: r.id,
  name: r.name,
  token: r.token,
  active: r.active,
  createdAt: r.created_at,
});

const toOrder = (r: any): Order => ({
  id: r.id,
  tableId: r.table_id,
  tableName: r.table_name,
  lines: r.lines ?? [],
  total: r.total,
  note: r.note,
  status: r.status,
  saleId: r.sale_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toSale = (r: any): Sale => ({
  id: r.id,
  businessDate: r.business_date,
  reservationId: r.reservation_id,
  customerId: r.customer_id,
  staffId: r.staff_id,
  channel: r.channel,
  customerName: r.customer_name,
  partySize: r.party_size,
  drinkAmount: r.drink_amount,
  chargeAmount: r.charge_amount,
  serviceAmount: r.service_amount,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SALE_COLUMNS: Record<keyof SalePatch, string> = {
  businessDate: "business_date",
  reservationId: "reservation_id",
  customerId: "customer_id",
  staffId: "staff_id",
  channel: "channel",
  customerName: "customer_name",
  partySize: "party_size",
  drinkAmount: "drink_amount",
  chargeAmount: "charge_amount",
  serviceAmount: "service_amount",
  note: "note",
};

const saleColumns = (p: SalePatch) =>
  Object.fromEntries(
    Object.entries(p)
      .filter(([k, v]) => v !== undefined && k in SALE_COLUMNS)
      .map(([k, v]) => [SALE_COLUMNS[k as keyof SalePatch], v]),
  );

const toAttachment = (r: any): Attachment => ({
  id: r.id,
  saleId: r.sale_id,
  fileName: r.file_name,
  contentType: r.content_type,
  size: r.size,
  createdAt: r.created_at,
});

const toMessage = (r: any): MessageLog => ({
  id: r.id,
  customerId: r.customer_id,
  direction: r.direction,
  text: r.text,
  extraction: r.extraction,
  createdAt: r.created_at,
});

// Postgresは "2026-10-25T12:00:00+00:00" 形式で返すので、比較できるようISOに揃える
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

const toReservation = (r: any): Reservation => ({
  id: r.id,
  customerId: r.customer_id,
  startAt: iso(r.start_at)!,
  endAt: iso(r.end_at)!,
  partySize: r.party_size,
  name: r.name,
  notes: r.notes,
  status: r.status,
  channel: r.channel,
  googleEventId: r.google_event_id,
  reminderSentAt: iso(r.reminder_sent_at),
  // created_at はマイクロ秒精度のまま保持する（先着判定に使う）
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const reservationColumns = (p: ReservationPatch | NewReservation) => {
  const row: Record<string, unknown> = {};
  if ("customerId" in p) row.customer_id = p.customerId;
  if ("channel" in p) row.channel = p.channel;
  if (p.startAt !== undefined) row.start_at = p.startAt;
  if (p.endAt !== undefined) row.end_at = p.endAt;
  if (p.partySize !== undefined) row.party_size = p.partySize;
  if (p.name !== undefined) row.name = p.name;
  if (p.notes !== undefined) row.notes = p.notes;
  if (p.status !== undefined) row.status = p.status;
  if ("googleEventId" in p && p.googleEventId !== undefined) row.google_event_id = p.googleEventId;
  if ("reminderSentAt" in p && p.reminderSentAt !== undefined) row.reminder_sent_at = p.reminderSentAt;
  return row;
};

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Supabase: ${res.error.message}`);
  return res.data;
}

export class SupabaseRepository implements Repository {
  private db: ReturnType<typeof supabaseClient>;

  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly encryptionKey: string,
  ) {
    this.db = supabaseClient(url, serviceRoleKey);
  }

  async getSettings(): Promise<ShopSettings> {
    const data = check(await this.db.from("shop_settings").select("data").eq("id", 1).maybeSingle());
    return { ...DEFAULT_SETTINGS, ...((data as any)?.data ?? {}) };
  }
  async saveSettings(settings: ShopSettings) {
    check(
      await this.db
        .from("shop_settings")
        .upsert({ id: 1, data: settings, updated_at: new Date().toISOString() }),
    );
  }

  async getGoogleIntegration(): Promise<GoogleIntegration | null> {
    const row: any = check(await this.db.from("google_integration").select("*").eq("id", 1).maybeSingle());
    if (!row) return null;
    return {
      refreshToken: decrypt(row.refresh_token_encrypted, this.encryptionKey),
      calendarId: row.calendar_id,
      accountEmail: row.account_email,
    };
  }
  async saveGoogleIntegration(integration: GoogleIntegration | null) {
    if (!integration) {
      check(await this.db.from("google_integration").delete().eq("id", 1));
      return;
    }
    check(
      await this.db.from("google_integration").upsert({
        id: 1,
        refresh_token_encrypted: encrypt(integration.refreshToken, this.encryptionKey),
        calendar_id: integration.calendarId,
        account_email: integration.accountEmail,
        updated_at: new Date().toISOString(),
      }),
    );
  }

  async findOrCreateCustomer(channel: Channel, externalId: string | null, displayName: string | null) {
    if (!externalId) {
      const row = check(
        await this.db.from("customers").insert({ channel, display_name: displayName }).select().single(),
      );
      return toCustomer(row);
    }
    const existing: any = check(
      await this.db
        .from("customers")
        .select()
        .eq("channel", channel)
        .eq("external_id", externalId)
        .maybeSingle(),
    );
    if (existing) {
      if (displayName && existing.display_name !== displayName) {
        check(await this.db.from("customers").update({ display_name: displayName }).eq("id", existing.id));
        existing.display_name = displayName;
      }
      return toCustomer(existing);
    }
    // 同時に初回メッセージが来ても重複しないよう upsert する
    const row = check(
      await this.db
        .from("customers")
        .upsert(
          { channel, external_id: externalId, display_name: displayName },
          { onConflict: "channel,external_id" },
        )
        .select()
        .single(),
    );
    return toCustomer(row);
  }
  async getCustomer(id: string) {
    const row = check(await this.db.from("customers").select().eq("id", id).maybeSingle());
    return row ? toCustomer(row) : null;
  }
  async listCustomers(q: { search?: string; limit: number }) {
    let query = this.db.from("customers").select().order("created_at", { ascending: false }).limit(q.limit);
    // PostgRESTの or() 構文を壊す文字は取り除く
    const term = q.search?.replace(/[,()%*\\]/g, "").trim();
    const digits = term?.replace(/\D/g, "");
    if (term) {
      query = query.or(
        [`name.ilike.%${term}%`, `display_name.ilike.%${term}%`, ...(digits && digits.length >= 3 ? [`phone.ilike.%${digits}%`] : [])].join(","),
      );
    }
    return (check(await query) as any[]).map(toCustomer);
  }
  async createCustomer(input: Pick<Customer, "channel" | "name" | "phone" | "birthday" | "tags" | "note" | "staffId">) {
    const row = check(
      await this.db
        .from("customers")
        .insert({
          channel: input.channel,
          name: input.name,
          phone: input.phone,
          birthday: input.birthday,
          tags: input.tags,
          note: input.note,
          staff_id: input.staffId,
        })
        .select()
        .single(),
    );
    return toCustomer(row);
  }
  async updateCustomer(id: string, patch: CustomerPatch) {
    const row: Record<string, unknown> = {};
    if (patch.staffId !== undefined) row.staff_id = patch.staffId;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.note !== undefined) row.note = patch.note;
    if (patch.displayName !== undefined) row.display_name = patch.displayName;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.birthday !== undefined) row.birthday = patch.birthday;
    if (patch.tags !== undefined) row.tags = patch.tags;
    if (patch.birthdayGreetedYear !== undefined) row.birthday_greeted_year = patch.birthdayGreetedYear;
    check(await this.db.from("customers").update(row).eq("id", id));
  }

  async addMessage(entry: Omit<MessageLog, "id" | "createdAt">) {
    const row = check(
      await this.db
        .from("messages")
        .insert({
          customer_id: entry.customerId,
          direction: entry.direction,
          text: entry.text,
          extraction: entry.extraction,
        })
        .select()
        .single(),
    );
    return toMessage(row);
  }
  async listMessages(customerId: string, since: Date, limit: number) {
    const rows = check(
      await this.db
        .from("messages")
        .select()
        .eq("customer_id", customerId)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(limit),
    );
    return (rows as any[]).map(toMessage).reverse();
  }
  async listRecentConversations(limit: number) {
    const rows = check(
      await this.db
        .from("messages")
        .select("*, customers(*)")
        .order("created_at", { ascending: false })
        .limit(limit * 20),
    ) as any[];
    const seen = new Set<string>();
    const result: { customer: Customer; last: MessageLog }[] = [];
    for (const r of rows) {
      if (seen.has(r.customer_id)) continue;
      seen.add(r.customer_id);
      result.push({ customer: toCustomer(r.customers), last: toMessage(r) });
      if (result.length >= limit) break;
    }
    return result;
  }

  async getDraft(customerId: string): Promise<Draft | null> {
    const row: any = check(await this.db.from("drafts").select().eq("customer_id", customerId).maybeSingle());
    return row ? { ...row.data, customerId, updatedAt: row.updated_at } : null;
  }
  async saveDraft(draft: Draft) {
    const { customerId, updatedAt, ...data } = draft;
    check(
      await this.db.from("drafts").upsert({ customer_id: customerId, data, updated_at: updatedAt }),
    );
  }
  async deleteDraft(customerId: string) {
    check(await this.db.from("drafts").delete().eq("customer_id", customerId));
  }

  async createReservation(input: NewReservation) {
    const row = check(
      await this.db.from("reservations").insert(reservationColumns(input)).select().single(),
    );
    return toReservation(row);
  }
  async updateReservation(id: string, patch: ReservationPatch) {
    const row = check(
      await this.db
        .from("reservations")
        .update({ ...reservationColumns(patch), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single(),
    );
    return toReservation(row);
  }
  async deleteReservation(id: string) {
    check(await this.db.from("reservations").delete().eq("id", id));
  }
  async getReservation(id: string) {
    const row = check(await this.db.from("reservations").select().eq("id", id).maybeSingle());
    return row ? toReservation(row) : null;
  }
  async listReservations(q: ReservationQuery) {
    let query = this.db.from("reservations").select().order("start_at", { ascending: true });
    if (q.from) query = query.gt("end_at", q.from.toISOString());
    if (q.to) query = query.lt("start_at", q.to.toISOString());
    if (q.statuses) query = query.in("status", [...q.statuses]);
    if (q.customerId) query = query.eq("customer_id", q.customerId);
    const rows = check(await query.limit(1000));
    return (rows as any[]).map(toReservation);
  }

  async listStaff() {
    const rows = check(await this.db.from("staff").select().order("created_at"));
    return (rows as any[]).map(toStaff);
  }
  async getStaff(id: string) {
    const row = check(await this.db.from("staff").select().eq("id", id).maybeSingle());
    return row ? toStaff(row) : null;
  }
  async createStaff(input: NewStaff) {
    const row = check(
      await this.db
        .from("staff")
        .insert({
          name: input.name,
          back_rates: input.backRates,
          active: input.active,
          password_hash: input.passwordHash ?? null,
          pending: input.pending ?? false,
        })
        .select()
        .single(),
    );
    return toStaff(row);
  }
  async updateStaff(id: string, patch: Partial<Omit<Staff, "id" | "createdAt">>) {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.backRates !== undefined) row.back_rates = patch.backRates;
    if (patch.active !== undefined) row.active = patch.active;
    if (patch.passwordHash !== undefined) row.password_hash = patch.passwordHash;
    if (patch.pending !== undefined) row.pending = patch.pending;
    return toStaff(check(await this.db.from("staff").update(row).eq("id", id).select().single()));
  }

  async createSale(input: NewSale) {
    return toSale(check(await this.db.from("sales").insert(saleColumns(input)).select().single()));
  }
  async updateSale(id: string, patch: SalePatch) {
    const row = check(
      await this.db
        .from("sales")
        .update({ ...saleColumns(patch), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single(),
    );
    return toSale(row);
  }
  async deleteSale(id: string) {
    const rows = check(await this.db.from("sale_attachments").select("storage_path").eq("sale_id", id)) as any[];
    if (rows.length) {
      const { error } = await this.db.storage.from(BUCKET).remove(rows.map((r) => r.storage_path));
      if (error) throw new Error(`Supabase storage: ${error.message}`);
    }
    check(await this.db.from("sales").delete().eq("id", id));
  }
  async getSale(id: string) {
    const row = check(await this.db.from("sales").select().eq("id", id).maybeSingle());
    return row ? toSale(row) : null;
  }
  async listSales(q: SaleQuery) {
    let query = this.db
      .from("sales")
      .select()
      .order("business_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (q.fromDate) query = query.gte("business_date", q.fromDate);
    if (q.toDate) query = query.lte("business_date", q.toDate);
    if (q.reservationId) query = query.eq("reservation_id", q.reservationId);
    if (q.customerId) query = query.eq("customer_id", q.customerId);
    const rows = check(await query.limit(5000));
    return (rows as any[]).map(toSale);
  }

  async addAttachment(meta: Omit<Attachment, "id" | "createdAt">, data: Uint8Array) {
    const path = `${meta.saleId}/${randomUUID()}`;
    const { error } = await this.db.storage
      .from(BUCKET)
      .upload(path, data, { contentType: meta.contentType, upsert: false });
    if (error) throw new Error(`Supabase storage: ${error.message}`);
    try {
      const row = check(
        await this.db
          .from("sale_attachments")
          .insert({
            sale_id: meta.saleId,
            file_name: meta.fileName,
            content_type: meta.contentType,
            size: meta.size,
            storage_path: path,
          })
          .select()
          .single(),
      );
      return toAttachment(row);
    } catch (e) {
      await this.db.storage.from(BUCKET).remove([path]);
      throw e;
    }
  }
  async listAttachments(saleId: string) {
    const rows = check(
      await this.db.from("sale_attachments").select().eq("sale_id", saleId).order("created_at"),
    );
    return (rows as any[]).map(toAttachment);
  }
  async getAttachment(id: string) {
    const row: any = check(await this.db.from("sale_attachments").select().eq("id", id).maybeSingle());
    if (!row) return null;
    const { data, error } = await this.db.storage.from(BUCKET).download(row.storage_path);
    if (error || !data) throw new Error(`Supabase storage: ${error?.message ?? "no data"}`);
    return { meta: toAttachment(row), data: new Uint8Array(await data.arrayBuffer()) };
  }
  async recordWebRequest(ip: string) {
    check(await this.db.from("web_requests").insert({ ip }));
  }
  async countWebRequests(since: Date, ip?: string) {
    let query = this.db
      .from("web_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since.toISOString());
    if (ip) query = query.eq("ip", ip);
    const res = await query;
    if (res.error) throw new Error(`Supabase: ${res.error.message}`);
    return res.count ?? 0;
  }

  async recordLoginFailure(ip: string) {
    check(await this.db.from("login_failures").insert({ ip }));
  }
  async countLoginFailures(since: Date, ip?: string) {
    let query = this.db
      .from("login_failures")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since.toISOString());
    if (ip) query = query.eq("ip", ip);
    const res = await query;
    if (res.error) throw new Error(`Supabase: ${res.error.message}`);
    return res.count ?? 0;
  }

  async purgePersonalData(cutoff: Date): Promise<PurgeResult> {
    return check(await this.db.rpc("purge_personal_data", { cutoff: cutoff.toISOString() })) as PurgeResult;
  }

  async listMenu() {
    const rows = check(await this.db.from("menu_items").select().order("sort_order").order("created_at"));
    return (rows as any[]).map(toMenuItem);
  }
  async createMenuItem(input: Omit<MenuItem, "id" | "createdAt">) {
    const row = check(
      await this.db
        .from("menu_items")
        .insert({ name: input.name, category: input.category, price: input.price, available: input.available, sort_order: input.sortOrder })
        .select()
        .single(),
    );
    return toMenuItem(row);
  }
  async updateMenuItem(id: string, patch: Partial<Omit<MenuItem, "id" | "createdAt">>) {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.price !== undefined) row.price = patch.price;
    if (patch.available !== undefined) row.available = patch.available;
    if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
    return toMenuItem(check(await this.db.from("menu_items").update(row).eq("id", id).select().single()));
  }
  async deleteMenuItem(id: string) {
    check(await this.db.from("menu_items").delete().eq("id", id));
  }

  async listOrderTables() {
    const rows = check(await this.db.from("order_tables").select().order("created_at"));
    return (rows as any[]).map(toOrderTable);
  }
  async getOrderTableByToken(token: string) {
    const row = check(await this.db.from("order_tables").select().eq("token", token).maybeSingle());
    return row ? toOrderTable(row) : null;
  }
  async createOrderTable(input: Omit<OrderTable, "id" | "createdAt">) {
    const row = check(
      await this.db.from("order_tables").insert({ name: input.name, token: input.token, active: input.active }).select().single(),
    );
    return toOrderTable(row);
  }
  async updateOrderTable(id: string, patch: Partial<Omit<OrderTable, "id" | "createdAt">>) {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.token !== undefined) row.token = patch.token;
    if (patch.active !== undefined) row.active = patch.active;
    return toOrderTable(check(await this.db.from("order_tables").update(row).eq("id", id).select().single()));
  }

  async createOrder(input: { tableId: string; tableName: string; lines: Order["lines"]; total: number; note: string | null }) {
    const row = check(
      await this.db
        .from("orders")
        .insert({ table_id: input.tableId, table_name: input.tableName, lines: input.lines, total: input.total, note: input.note })
        .select()
        .single(),
    );
    return toOrder(row);
  }
  async getOrder(id: string) {
    const row = check(await this.db.from("orders").select().eq("id", id).maybeSingle());
    return row ? toOrder(row) : null;
  }
  async listOrders(query: OrderQuery) {
    let q = this.db.from("orders").select().order("created_at", { ascending: false }).limit(query.limit ?? 500);
    if (query.since) q = q.gte("created_at", query.since.toISOString());
    if (query.tableId) q = q.eq("table_id", query.tableId);
    if (query.status) q = q.eq("status", query.status);
    return (check(await q) as any[]).map(toOrder);
  }
  async updateOrder(id: string, patch: Partial<Pick<Order, "status" | "saleId">>) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.saleId !== undefined) row.sale_id = patch.saleId;
    return toOrder(check(await this.db.from("orders").update(row).eq("id", id).select().single()));
  }

  async savePromoImage(key: string, data: Uint8Array, contentType: string) {
    const { error } = await this.db.storage.from(BUCKET).upload(`promo/${key}`, data, { contentType, upsert: true });
    if (error) throw new Error(`Supabase storage: ${error.message}`);
  }
  async getPromoImage(key: string) {
    const { data, error } = await this.db.storage.from(BUCKET).download(`promo/${key}`);
    if (error || !data) return null;
    return { data: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "image/jpeg" };
  }

  async addAudit(entry: Omit<AuditLog, "id" | "createdAt">) {
    check(
      await this.db.from("audit_logs").insert({
        actor: entry.actor,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        detail: entry.detail,
      }),
    );
  }
  async listAudit(q: { targetId?: string; limit: number }) {
    let query = this.db.from("audit_logs").select().order("created_at", { ascending: false }).limit(q.limit);
    if (q.targetId) query = query.eq("target_id", q.targetId);
    const rows = check(await query) as any[];
    return rows.map(
      (r): AuditLog => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        detail: r.detail,
        createdAt: r.created_at,
      }),
    );
  }

  async deleteAttachment(id: string) {
    const row: any = check(
      await this.db.from("sale_attachments").select("storage_path").eq("id", id).maybeSingle(),
    );
    if (!row) return;
    const { error } = await this.db.storage.from(BUCKET).remove([row.storage_path]);
    if (error) throw new Error(`Supabase storage: ${error.message}`);
    check(await this.db.from("sale_attachments").delete().eq("id", id));
  }
}
