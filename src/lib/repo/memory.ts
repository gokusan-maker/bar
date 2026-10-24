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

/**
 * プロセス内メモリに保存する実装。ローカル開発・テスト用（再起動で消える）。
 */
export class MemoryRepository implements Repository {
  private settings: ShopSettings = { ...DEFAULT_SETTINGS };
  private google: GoogleIntegration | null = null;
  private customers = new Map<string, Customer>();
  private messages: MessageLog[] = [];
  private drafts = new Map<string, Draft>();
  private reservations = new Map<string, Reservation>();
  private staff = new Map<string, Staff>();
  private sales = new Map<string, Sale>();
  private attachments = new Map<string, { meta: Attachment; data: Uint8Array }>();
  private audit: AuditLog[] = [];
  private loginFailures: { ip: string; at: string }[] = [];
  private webRequests: { ip: string; at: string }[] = [];
  private menu = new Map<string, MenuItem>();
  private orderTables = new Map<string, OrderTable>();
  private orders = new Map<string, Order>();
  private promoImages = new Map<string, { data: Uint8Array; contentType: string }>();
  /** 同一ミリ秒でも作成順が決まるように使う */
  private seq = 0;

  private stamp(): string {
    // 作成順を厳密に保つため、ミリ秒が重なったら1msずらす
    const now = Date.now();
    this.seq = Math.max(this.seq + 1, now);
    return new Date(this.seq).toISOString();
  }

  async getSettings() {
    return { ...this.settings };
  }
  async saveSettings(settings: ShopSettings) {
    this.settings = { ...settings };
  }

  async getGoogleIntegration() {
    return this.google;
  }
  async saveGoogleIntegration(integration: GoogleIntegration | null) {
    this.google = integration;
  }

  async findOrCreateCustomer(channel: Channel, externalId: string | null, displayName: string | null) {
    if (externalId) {
      for (const c of this.customers.values()) {
        if (c.channel === channel && c.externalId === externalId) {
          if (displayName && c.displayName !== displayName) c.displayName = displayName;
          return { ...c };
        }
      }
    }
    const customer: Customer = {
      id: randomUUID(),
      channel,
      externalId,
      displayName,
      name: null,
      note: null,
      staffId: null,
      phone: null,
      birthday: null,
      tags: [],
      birthdayGreetedYear: null,
      createdAt: this.stamp(),
    };
    this.customers.set(customer.id, customer);
    return { ...customer };
  }
  async getCustomer(id: string) {
    const c = this.customers.get(id);
    return c ? { ...c } : null;
  }
  async listCustomers(q: { search?: string; limit: number }) {
    const term = q.search?.trim();
    const digits = term?.replace(/\D/g, "");
    return [...this.customers.values()]
      .filter(
        (c) =>
          !term ||
          c.name?.includes(term) ||
          c.displayName?.includes(term) ||
          (!!digits && digits.length >= 3 && !!c.phone?.includes(digits)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, q.limit)
      .map((c) => ({ ...c, tags: [...c.tags] }));
  }
  async createCustomer(input: Pick<Customer, "channel" | "name" | "phone" | "birthday" | "tags" | "note" | "staffId">) {
    const customer: Customer = {
      ...input,
      tags: [...input.tags],
      id: randomUUID(),
      externalId: null,
      displayName: null,
      birthdayGreetedYear: null,
      createdAt: this.stamp(),
    };
    this.customers.set(customer.id, customer);
    return { ...customer, tags: [...customer.tags] };
  }
  async updateCustomer(id: string, patch: CustomerPatch) {
    const c = this.customers.get(id);
    if (c) Object.assign(c, patch);
  }

  async addMessage(entry: Omit<MessageLog, "id" | "createdAt">) {
    const log: MessageLog = { ...entry, id: randomUUID(), createdAt: this.stamp() };
    this.messages.push(log);
    return log;
  }
  async listMessages(customerId: string, since: Date, limit: number) {
    return this.messages
      .filter((m) => m.customerId === customerId && m.createdAt >= since.toISOString())
      .slice(-limit);
  }
  async listRecentConversations(limit: number) {
    const last = new Map<string, MessageLog>();
    for (const m of this.messages) last.set(m.customerId, m);
    return [...last.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((m) => ({ customer: { ...this.customers.get(m.customerId)! }, last: m }));
  }

  async getDraft(customerId: string) {
    const d = this.drafts.get(customerId);
    return d ? { ...d } : null;
  }
  async saveDraft(draft: Draft) {
    this.drafts.set(draft.customerId, { ...draft });
  }
  async deleteDraft(customerId: string) {
    this.drafts.delete(customerId);
  }

  async createReservation(input: NewReservation) {
    const at = this.stamp();
    const r: Reservation = {
      ...input,
      id: randomUUID(),
      googleEventId: null,
      reminderSentAt: null,
      createdAt: at,
      updatedAt: at,
    };
    this.reservations.set(r.id, r);
    return { ...r };
  }
  async updateReservation(id: string, patch: ReservationPatch) {
    const r = this.reservations.get(id);
    if (!r) throw new Error(`reservation not found: ${id}`);
    Object.assign(r, patch, { updatedAt: new Date().toISOString() });
    return { ...r };
  }
  async deleteReservation(id: string) {
    this.reservations.delete(id);
  }
  async getReservation(id: string) {
    const r = this.reservations.get(id);
    return r ? { ...r } : null;
  }
  async listReservations(q: ReservationQuery) {
    return [...this.reservations.values()]
      .filter(
        (r) =>
          (!q.from || r.endAt > q.from.toISOString()) &&
          (!q.to || r.startAt < q.to.toISOString()) &&
          (!q.statuses || q.statuses.includes(r.status)) &&
          (!q.customerId || r.customerId === q.customerId),
      )
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .map((r) => ({ ...r }));
  }

  async listStaff() {
    return [...this.staff.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((s) => ({ ...s, backRates: { ...s.backRates } }));
  }
  async getStaff(id: string) {
    const s = this.staff.get(id);
    return s ? { ...s, backRates: { ...s.backRates } } : null;
  }
  async createStaff(input: NewStaff) {
    const s: Staff = {
      passwordHash: null,
      pending: false,
      lineUserId: null,
      loginId: null,
      ...input,
      backRates: { ...input.backRates },
      id: randomUUID(),
      createdAt: this.stamp(),
    };
    this.staff.set(s.id, s);
    return { ...s };
  }
  async updateStaff(id: string, patch: Partial<Omit<Staff, "id" | "createdAt">>) {
    const s = this.staff.get(id);
    if (!s) throw new Error(`staff not found: ${id}`);
    Object.assign(s, patch);
    return { ...s, backRates: { ...s.backRates } };
  }

  async createSale(input: NewSale) {
    const at = this.stamp();
    const sale: Sale = { ...input, id: randomUUID(), createdAt: at, updatedAt: at };
    this.sales.set(sale.id, sale);
    return { ...sale };
  }
  async updateSale(id: string, patch: SalePatch) {
    const sale = this.sales.get(id);
    if (!sale) throw new Error(`sale not found: ${id}`);
    Object.assign(sale, patch, { updatedAt: new Date().toISOString() });
    return { ...sale };
  }
  async deleteSale(id: string) {
    this.sales.delete(id);
    for (const [key, a] of this.attachments) if (a.meta.saleId === id) this.attachments.delete(key);
  }
  async getSale(id: string) {
    const sale = this.sales.get(id);
    return sale ? { ...sale } : null;
  }
  async listSales(q: SaleQuery) {
    return [...this.sales.values()]
      .filter(
        (s) =>
          (!q.fromDate || s.businessDate >= q.fromDate) &&
          (!q.toDate || s.businessDate <= q.toDate) &&
          (!q.reservationId || s.reservationId === q.reservationId) &&
          (!q.customerId || s.customerId === q.customerId),
      )
      .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.createdAt.localeCompare(b.createdAt))
      .map((s) => ({ ...s }));
  }

  async addAttachment(meta: Omit<Attachment, "id" | "createdAt">, data: Uint8Array) {
    const a: Attachment = { ...meta, id: randomUUID(), createdAt: this.stamp() };
    this.attachments.set(a.id, { meta: a, data });
    return { ...a };
  }
  async listAttachments(saleId: string) {
    return [...this.attachments.values()]
      .filter((a) => a.meta.saleId === saleId)
      .map((a) => ({ ...a.meta }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async getAttachment(id: string) {
    const a = this.attachments.get(id);
    return a ? { meta: { ...a.meta }, data: a.data } : null;
  }
  async deleteAttachment(id: string) {
    this.attachments.delete(id);
  }

  async recordWebRequest(ip: string) {
    this.webRequests.push({ ip, at: new Date().toISOString() });
  }
  async countWebRequests(since: Date, ip?: string) {
    return this.webRequests.filter((f) => f.at >= since.toISOString() && (!ip || f.ip === ip)).length;
  }

  async recordLoginFailure(ip: string) {
    this.loginFailures.push({ ip, at: new Date().toISOString() });
  }
  async countLoginFailures(since: Date, ip?: string) {
    return this.loginFailures.filter((f) => f.at >= since.toISOString() && (!ip || f.ip === ip)).length;
  }

  async purgePersonalData(cutoff: Date): Promise<PurgeResult> {
    const c = cutoff.toISOString();
    const cutoffDate = new Date(cutoff.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
    const before = this.messages.length;
    this.messages = this.messages.filter((m) => m.createdAt >= c);
    for (const [id, d] of this.drafts) if (d.updatedAt < c) this.drafts.delete(id);
    let reservations = 0;
    for (const r of this.reservations.values()) {
      if (r.endAt < c && r.name !== "（削除済み）") {
        r.name = "（削除済み）";
        r.notes = null;
        reservations++;
      }
    }
    let sales = 0;
    for (const s of this.sales.values()) {
      if (s.businessDate < cutoffDate && s.customerName !== null) {
        s.customerName = null;
        s.note = null;
        sales++;
      }
    }
    let customers = 0;
    for (const cu of this.customers.values()) {
      const hasPersonal = cu.name || cu.displayName || cu.externalId || cu.note || cu.phone || cu.birthday;
      const recent =
        [...this.reservations.values()].some((r) => r.customerId === cu.id && r.endAt >= c) ||
        this.messages.some((m) => m.customerId === cu.id) ||
        [...this.sales.values()].some((s) => s.customerId === cu.id && s.businessDate >= cutoffDate);
      if (cu.createdAt < c && hasPersonal && !recent) {
        Object.assign(cu, { name: null, displayName: null, externalId: null, note: null, phone: null, birthday: null, tags: [] });
        customers++;
      }
    }
    return { messages: before - this.messages.length, reservations, sales, customers };
  }

  async listMenu() {
    return [...this.menu.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
      .map((m) => ({ ...m }));
  }
  async createMenuItem(input: Omit<MenuItem, "id" | "createdAt">) {
    const m: MenuItem = { ...input, id: randomUUID(), createdAt: this.stamp() };
    this.menu.set(m.id, m);
    return { ...m };
  }
  async updateMenuItem(id: string, patch: Partial<Omit<MenuItem, "id" | "createdAt">>) {
    const m = this.menu.get(id);
    if (!m) throw new Error(`menu item not found: ${id}`);
    Object.assign(m, patch);
    return { ...m };
  }
  async deleteMenuItem(id: string) {
    this.menu.delete(id);
  }

  async listOrderTables() {
    return [...this.orderTables.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((t) => ({ ...t }));
  }
  async getOrderTableByToken(token: string) {
    const t = [...this.orderTables.values()].find((x) => x.token === token);
    return t ? { ...t } : null;
  }
  async createOrderTable(input: Omit<OrderTable, "id" | "createdAt">) {
    const t: OrderTable = { ...input, id: randomUUID(), createdAt: this.stamp() };
    this.orderTables.set(t.id, t);
    return { ...t };
  }
  async updateOrderTable(id: string, patch: Partial<Omit<OrderTable, "id" | "createdAt">>) {
    const t = this.orderTables.get(id);
    if (!t) throw new Error(`table not found: ${id}`);
    Object.assign(t, patch);
    return { ...t };
  }

  async createOrder(input: { tableId: string; tableName: string; lines: Order["lines"]; total: number; note: string | null }) {
    const at = this.stamp();
    const o: Order = { ...input, lines: input.lines.map((l) => ({ ...l })), status: "new", saleId: null, id: randomUUID(), createdAt: at, updatedAt: at };
    this.orders.set(o.id, o);
    return structuredClone(o);
  }
  async getOrder(id: string) {
    const o = this.orders.get(id);
    return o ? structuredClone(o) : null;
  }
  async listOrders(query: OrderQuery) {
    return [...this.orders.values()]
      .filter(
        (o) =>
          (!query.since || o.createdAt >= query.since.toISOString()) &&
          (!query.tableId || o.tableId === query.tableId) &&
          (!query.status || o.status === query.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, query.limit ?? 500)
      .map((o) => structuredClone(o));
  }
  async updateOrder(id: string, patch: Partial<Pick<Order, "status" | "saleId">>) {
    const o = this.orders.get(id);
    if (!o) throw new Error(`order not found: ${id}`);
    Object.assign(o, patch, { updatedAt: this.stamp() });
    return structuredClone(o);
  }

  async savePromoImage(key: string, data: Uint8Array, contentType: string) {
    this.promoImages.set(key, { data, contentType });
  }
  async getPromoImage(key: string) {
    return this.promoImages.get(key) ?? null;
  }

  async addAudit(entry: Omit<AuditLog, "id" | "createdAt">) {
    this.audit.push({ ...entry, id: randomUUID(), createdAt: this.stamp() });
  }
  async listAudit(q: { targetId?: string; limit: number }) {
    return this.audit
      .filter((a) => !q.targetId || a.targetId === q.targetId)
      .slice(-q.limit)
      .reverse()
      .map((a) => ({ ...a }));
  }
}
