import type { Interval } from "./domain/availability";
import type { Customer, Reservation, ShopSettings } from "./domain/types";

/** Googleカレンダーなど外部カレンダーとの同期 */
export interface CalendarSync {
  /** 予定を作成/更新し、イベントIDを返す */
  upsert(reservation: Reservation, settings: ShopSettings): Promise<string | null>;
  remove(reservation: Reservation): Promise<void>;
  /** 予約以外の予定（休業・貸切など）の時間帯 */
  busyBlocks(from: Date, to: Date): Promise<Interval[]>;
  /**
   * カレンダー上の予定の現在の時間。削除されていれば "deleted"。
   * 連携していない・終日予定などで判断できなければ null
   */
  getEvent(eventId: string): Promise<Interval | "deleted" | null>;
}

/** お客様へのメッセージ送信（返信トークンを使わないプッシュ送信） */
export interface Messenger {
  push(customer: Customer, text: string): Promise<void>;
}

/** 店主への通知 */
export interface Notifier {
  notify(text: string): Promise<void>;
}

export const noopCalendar: CalendarSync = {
  async upsert() {
    return null;
  },
  async remove() {},
  async busyBlocks() {
    return [];
  },
  async getEvent() {
    return null;
  },
};

export const noopNotifier: Notifier = {
  async notify() {},
};
