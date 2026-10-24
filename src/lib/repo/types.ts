import type {
  Attachment,
  MenuItem,
  Order,
  OrderLine,
  OrderStatus,
  OrderTable,
  AuditLog,
  Channel,
  Customer,
  Draft,
  GoogleIntegration,
  MessageLog,
  Reservation,
  ReservationStatus,
  Sale,
  ShopSettings,
  Staff,
} from "../domain/types";

export type NewReservation = Omit<
  Reservation,
  "id" | "createdAt" | "updatedAt" | "googleEventId" | "reminderSentAt"
>;

export type ReservationPatch = Partial<
  Pick<
    Reservation,
    "startAt" | "endAt" | "partySize" | "name" | "notes" | "status" | "googleEventId" | "reminderSentAt"
  >
>;

export type NewSale = Omit<Sale, "id" | "createdAt" | "updatedAt">;
export type SalePatch = Partial<Omit<Sale, "id" | "createdAt" | "updatedAt">>;

export interface PurgeResult {
  messages: number;
  reservations: number;
  sales: number;
  customers: number;
}

export interface SaleQuery {
  /** 営業日 "YYYY-MM-DD"（両端を含む） */
  fromDate?: string;
  toDate?: string;
  reservationId?: string;
  customerId?: string;
}

export interface ReservationQuery {
  /** この時刻以降に終わる予約 */
  from?: Date;
  /** この時刻より前に始まる予約 */
  to?: Date;
  statuses?: readonly ReservationStatus[];
  customerId?: string;
}

/**
 * 永続化の抽象。開発・テスト用のメモリ実装と、本番用のSupabase実装がある。
 */
/** ログイン関係は省略するとログインなし */
export type NewStaff = Omit<Staff, "id" | "createdAt" | "passwordHash" | "pending" | "lineUserId"> &
  Partial<Pick<Staff, "passwordHash" | "pending" | "lineUserId">>;

export type CustomerPatch = Partial<
  Pick<Customer, "name" | "note" | "displayName" | "staffId" | "phone" | "birthday" | "tags" | "birthdayGreetedYear">
>;

export interface OrderQuery {
  /** この時刻以降に作られた注文 */
  since?: Date;
  tableId?: string;
  status?: OrderStatus;
  limit?: number;
}

export interface Repository {
  getSettings(): Promise<ShopSettings>;
  saveSettings(settings: ShopSettings): Promise<void>;

  getGoogleIntegration(): Promise<GoogleIntegration | null>;
  saveGoogleIntegration(integration: GoogleIntegration | null): Promise<void>;

  findOrCreateCustomer(
    channel: Channel,
    externalId: string | null,
    displayName: string | null,
  ): Promise<Customer>;
  getCustomer(id: string): Promise<Customer | null>;
  /** 名前・表示名で検索（新しい順）。search が空なら全件 */
  /** search は名前・表示名・電話番号の部分一致 */
  listCustomers(query: { search?: string; limit: number }): Promise<Customer[]>;
  /** 店で直接登録するお客様（SNSのIDなし） */
  createCustomer(input: Pick<Customer, "channel" | "name" | "phone" | "birthday" | "tags" | "note" | "staffId">): Promise<Customer>;
  updateCustomer(id: string, patch: CustomerPatch): Promise<void>;

  addMessage(entry: Omit<MessageLog, "id" | "createdAt">): Promise<MessageLog>;
  /** 新しい順ではなく古い順で返す */
  listMessages(customerId: string, since: Date, limit: number): Promise<MessageLog[]>;
  /** 最近メッセージのあった顧客（管理画面の受信箱用） */
  listRecentConversations(limit: number): Promise<{ customer: Customer; last: MessageLog }[]>;

  getDraft(customerId: string): Promise<Draft | null>;
  saveDraft(draft: Draft): Promise<void>;
  deleteDraft(customerId: string): Promise<void>;

  createReservation(input: NewReservation): Promise<Reservation>;
  updateReservation(id: string, patch: ReservationPatch): Promise<Reservation>;
  deleteReservation(id: string): Promise<void>;
  getReservation(id: string): Promise<Reservation | null>;
  /** 開始時刻の昇順 */
  listReservations(query: ReservationQuery): Promise<Reservation[]>;

  listStaff(): Promise<Staff[]>;
  getStaff(id: string): Promise<Staff | null>;
  createStaff(input: NewStaff): Promise<Staff>;
  updateStaff(id: string, patch: Partial<Omit<Staff, "id" | "createdAt">>): Promise<Staff>;

  createSale(input: NewSale): Promise<Sale>;
  updateSale(id: string, patch: SalePatch): Promise<Sale>;
  /** 添付ファイルも削除する */
  deleteSale(id: string): Promise<void>;
  getSale(id: string): Promise<Sale | null>;
  /** 営業日の昇順 */
  listSales(query: SaleQuery): Promise<Sale[]>;

  addAttachment(meta: Omit<Attachment, "id" | "createdAt">, data: Uint8Array): Promise<Attachment>;
  listAttachments(saleId: string): Promise<Attachment[]>;
  getAttachment(id: string): Promise<{ meta: Attachment; data: Uint8Array } | null>;
  deleteAttachment(id: string): Promise<void>;

  recordWebRequest(ip: string): Promise<void>;
  countWebRequests(since: Date, ip?: string): Promise<number>;

  recordLoginFailure(ip: string): Promise<void>;
  countLoginFailures(since: Date, ip?: string): Promise<number>;

  /** cutoff より古い個人情報を削除・匿名化する（売上の金額・証拠は残す） */
  purgePersonalData(cutoff: Date): Promise<PurgeResult>;

  /** 並び順（sortOrder・作成順） */
  listMenu(): Promise<MenuItem[]>;
  createMenuItem(input: Omit<MenuItem, "id" | "createdAt">): Promise<MenuItem>;
  updateMenuItem(id: string, patch: Partial<Omit<MenuItem, "id" | "createdAt">>): Promise<MenuItem>;
  deleteMenuItem(id: string): Promise<void>;

  listOrderTables(): Promise<OrderTable[]>;
  getOrderTableByToken(token: string): Promise<OrderTable | null>;
  createOrderTable(input: Omit<OrderTable, "id" | "createdAt">): Promise<OrderTable>;
  updateOrderTable(id: string, patch: Partial<Omit<OrderTable, "id" | "createdAt">>): Promise<OrderTable>;

  createOrder(input: { tableId: string; tableName: string; lines: OrderLine[]; total: number; note: string | null }): Promise<Order>;
  getOrder(id: string): Promise<Order | null>;
  /** 新しい順 */
  listOrders(query: OrderQuery): Promise<Order[]>;
  updateOrder(id: string, patch: Partial<Pick<Order, "status" | "saleId">>): Promise<Order>;

  /** 集客投稿の画像（Instagramが読みに来るので公開URLで配る） */
  savePromoImage(key: string, data: Uint8Array, contentType: string): Promise<void>;
  getPromoImage(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;

  addAudit(entry: Omit<AuditLog, "id" | "createdAt">): Promise<void>;
  /** 新しい順 */
  listAudit(query: { targetId?: string; limit: number }): Promise<AuditLog[]>;
}
