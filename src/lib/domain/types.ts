export type Channel = "line" | "instagram" | "x" | "web" | "simulator" | "manual";

export type ReservationStatus =
  | "pending" // 店主の承認待ち
  | "confirmed"
  | "cancelled"
  | "rejected"
  | "visited"
  | "no_show";

export const CHANNEL_LABEL: Record<Channel, string> = {
  line: "LINE",
  instagram: "Instagram",
  x: "X（Twitter）",
  web: "予約フォーム",
  simulator: "テスト",
  manual: "電話/来店",
};

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: "承認待ち",
  confirmed: "確定",
  cancelled: "キャンセル",
  rejected: "お断り",
  visited: "来店済",
  no_show: "無断キャンセル",
};

/** アプリからメッセージを送れる経路（予約フォーム・電話のお客様には店から電話する） */
export const canMessage = (channel: Channel) =>
  channel === "line" || channel === "instagram" || channel === "simulator";

/** 席を占有しているとみなすステータス */
export const ACTIVE_STATUSES: readonly ReservationStatus[] = ["pending", "confirmed"];

export interface Customer {
  id: string;
  channel: Channel;
  /** SNS側のユーザーID（manual の場合は null） */
  externalId: string | null;
  displayName: string | null;
  /** お客様が名乗った名前 */
  name: string | null;
  note: string | null;
  /** 担当スタッフ（バックの計算先） */
  staffId: string | null;
  createdAt: string;
}

export interface Reservation {
  id: string;
  customerId: string;
  /** ISO 8601 (UTC) */
  startAt: string;
  endAt: string;
  partySize: number;
  name: string;
  notes: string | null;
  status: ReservationStatus;
  channel: Channel;
  googleEventId: string | null;
  reminderSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageLog {
  id: string;
  customerId: string;
  direction: "in" | "out";
  text: string;
  /** 受信メッセージの解析結果（JSON） */
  extraction: unknown | null;
  createdAt: string;
}

/**
 * 予約の聞き取り途中の状態。不足項目をお客様に聞き返している間だけ存在する。
 */
export interface Draft {
  customerId: string;
  intent: "new" | "change";
  /** 変更の場合の対象予約 */
  targetReservationId: string | null;
  date: string | null;
  time: string | null;
  partySize: number | null;
  name: string | null;
  notes: string | null;
  updatedAt: string;
}

/** 席エリア（カウンター・テーブル・個室など） */
export interface SeatArea {
  name: string;
  seats: number;
}

export interface ShopSettings {
  shopName: string;
  /** 店の種類（バー、ダーツバー、スナックなど自由入力） */
  shopType: string;
  /** 席の構成。合計が capacity になる */
  seatAreas: SeatArea[];
  /** 開店時刻 "HH:MM" */
  openTime: string;
  /** 閉店時刻 "HH:MM"。24時以降は "26:00" のように書く */
  closeTime: string;
  /** 閉店の何分前まで入店（予約開始）を受け付けるか */
  lastEntryMinutesBeforeClose: number;
  /** 定休日（0=日曜 ... 6=土曜）。営業日の開店日基準 */
  closedWeekdays: number[];
  /** 臨時休業日 "YYYY-MM-DD" */
  closedDates: string[];
  /** 同時に受け入れられる最大人数（席数の合計） */
  capacity: number;
  /** 1組で受け付ける最大人数（超える場合は貸切相談として保留） */
  maxPartySize: number;
  /** 標準滞在時間（分） */
  stayMinutes: number;
  /** この人数以下なら自動確定 */
  autoConfirmMaxParty: number;
  /** 自動確定を有効にするか（false なら全件店主承認） */
  autoConfirm: boolean;
  /** 予約開始の何分前まで受け付けるか */
  minLeadMinutes: number;
  /** 何日先まで受け付けるか */
  maxAdvanceDays: number;
  /** Googleカレンダー上の（予約以外の）予定がある時間を受付不可にする */
  blockOnCalendarEvents: boolean;
  /** 前日リマインドを送る */
  sendReminders: boolean;
  /** 自動返信を止めて店主が手動で返信する */
  manualMode: boolean;
  /** 1人あたりのチャージ（席料・セット料金）。売上入力の初期値に使う */
  chargePerPerson: number;
  /** サービス料率（%）。ドリンク＋料金に対してかける */
  serviceChargeRate: number;
  /** バックの対象: SNS経由の売上だけか、すべての売上か */
  backTarget: "sns" | "all";
  /** 個人情報（名前・メッセージ）の保存期間（月）。0なら削除しない */
  retentionMonths: number;
  /** 公開の予約フォームを受け付ける */
  webBookingEnabled: boolean;
  /** テーマカラー（THEMES のキー） */
  themeColor: string;
  /** お店の電話番号（予約フォームと、直前予約などの返信に表示） */
  shopPhone: string;
  /** 予約フォームに表示するお店からのひとこと */
  shopMessage: string;
  /** LINE公式アカウントの友だち追加URL（https://lin.ee/...）。フォームや投稿でLINEへ案内する */
  lineFriendUrl: string;
}

export const DEFAULT_SETTINGS: ShopSettings = {
  shopName: "Bar",
  shopType: "バー",
  seatAreas: [
    { name: "カウンター", seats: 8 },
    { name: "テーブル", seats: 4 },
  ],
  openTime: "19:00",
  closeTime: "26:00",
  lastEntryMinutesBeforeClose: 60,
  closedWeekdays: [],
  closedDates: [],
  capacity: 12,
  maxPartySize: 8,
  stayMinutes: 120,
  autoConfirmMaxParty: 4,
  autoConfirm: true,
  minLeadMinutes: 30,
  maxAdvanceDays: 60,
  blockOnCalendarEvents: true,
  sendReminders: true,
  manualMode: false,
  chargePerPerson: 1000,
  serviceChargeRate: 10,
  backTarget: "sns",
  retentionMonths: 24,
  webBookingEnabled: false,
  themeColor: "amber",
  shopPhone: "",
  shopMessage: "",
  lineFriendUrl: "",
};

/** バック率（%）と1組あたりの固定バック（円） */
export interface BackRates {
  drink: number;
  charge: number;
  service: number;
  perVisit: number;
}

export interface Staff {
  id: string;
  name: string;
  backRates: BackRates;
  active: boolean;
  createdAt: string;
}

/** 1回の来店（1会計）の売上。金額はすべて円の整数 */
export interface Sale {
  id: string;
  /** 営業日 "YYYY-MM-DD" */
  businessDate: string;
  reservationId: string | null;
  customerId: string | null;
  staffId: string | null;
  /** 集客経路。予約から作った場合は予約の受付経路 */
  channel: Channel;
  customerName: string | null;
  partySize: number;
  /** お酒・ドリンク */
  drinkAmount: number;
  /** チャージ・セット料金など */
  chargeAmount: number;
  serviceAmount: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 売上の証拠（伝票・レシートの写真など） */
export interface Attachment {
  id: string;
  saleId: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
}

/** 操作履歴。誰が（店主・スタッフ・お客様・システム）何をしたか */
export interface AuditLog {
  id: string;
  actor: "owner" | "staff" | "guest" | "system";
  action: string;
  targetType: "reservation" | "sale" | "attachment" | "staff" | "settings" | "customer" | "integration";
  targetId: string | null;
  detail: string | null;
  createdAt: string;
}

export interface GoogleIntegration {
  refreshToken: string;
  calendarId: string;
  accountEmail: string | null;
}
