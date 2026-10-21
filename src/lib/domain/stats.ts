import { SNS_CHANNELS } from "./sales";
import type { Channel, Reservation, ReservationStatus } from "./types";

export interface ReservationStats {
  /** キャンセル・お断りを含む全受付数 */
  total: number;
  byStatus: Record<ReservationStatus, number>;
  byChannel: Record<Channel, number>;
  /** 無断キャンセル率（来店済み＋無断キャンセルに対する割合、0〜1）。対象がなければ null */
  noShowRate: number | null;
  /** キャンセル率（全受付に対する割合） */
  cancelRate: number | null;
  /** SNS経由の割合（売上と同じく、テスト送信もSNSとして数える） */
  snsShare: number | null;
  /** 来店済みの平均人数 */
  averageParty: number | null;
  /** 曜日別の受付数（0=日曜）。キャンセル・お断りは除く */
  byWeekday: number[];
}

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

/**
 * 月の予約の集計。businessWeekday は予約の営業日の曜日を返す関数（深夜帯を前日扱いにするため）。
 */
export function reservationStats(
  reservations: Reservation[],
  businessWeekday: (r: Reservation) => number,
): ReservationStats {
  const byStatus: Record<ReservationStatus, number> = {
    pending: 0, confirmed: 0, cancelled: 0, rejected: 0, visited: 0, no_show: 0,
  };
  const byChannel: Record<Channel, number> = { line: 0, instagram: 0, x: 0, web: 0, simulator: 0, manual: 0 };
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  let visitedGuests = 0;
  for (const r of reservations) {
    byStatus[r.status]++;
    byChannel[r.channel]++;
    if (r.status === "visited") visitedGuests += r.partySize;
    if (r.status !== "cancelled" && r.status !== "rejected") byWeekday[businessWeekday(r)]++;
  }
  const total = reservations.length;
  return {
    total,
    byStatus,
    byChannel,
    noShowRate: ratio(byStatus.no_show, byStatus.visited + byStatus.no_show),
    cancelRate: ratio(byStatus.cancelled, total),
    snsShare: ratio(SNS_CHANNELS.reduce((n, c) => n + byChannel[c], 0), total),
    averageParty: ratio(visitedGuests, byStatus.visited),
    byWeekday,
  };
}

export const percent = (v: number | null) => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`);
