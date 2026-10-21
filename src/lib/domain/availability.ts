import { addDays, fromJst, MINUTE_MS, parseClock, DAY_MS, toJst, weekdayOf } from "./time";
import type { ShopSettings } from "./types";

export interface Interval {
  start: Date;
  end: Date;
}

/** 空き判定に使う既存予約（人数と時間帯だけ） */
export interface Occupancy extends Interval {
  partySize: number;
}

export type UnavailableReason =
  | "past"
  | "too_soon"
  | "too_far"
  | "closed_day"
  | "outside_hours"
  | "party_too_large"
  | "blocked"
  | "full";

export type AvailabilityResult =
  | { ok: true; start: Date; end: Date; businessDate: string }
  | { ok: false; reason: UnavailableReason; businessDate: string | null };

export interface AvailabilityInput {
  settings: ShopSettings;
  now: Date;
  start: Date;
  partySize: number;
  occupancy: Occupancy[];
  /** カレンダー上の休業・貸切などの予定 */
  blocks: Interval[];
}

interface BusinessWindow {
  businessDate: string;
  open: Date;
  close: Date;
  lastEntry: Date;
}

function businessWindow(settings: ShopSettings, businessDate: string): BusinessWindow {
  const openMin = parseClock(settings.openTime) ?? 0;
  let closeMin = parseClock(settings.closeTime) ?? 0;
  // "02:00" のように開店より前の時刻が書かれていたら翌日とみなす
  if (closeMin <= openMin) closeMin += 24 * 60;
  const dayStart = fromJst(businessDate, "00:00").getTime();
  const open = new Date(dayStart + openMin * MINUTE_MS);
  const close = new Date(dayStart + closeMin * MINUTE_MS);
  const lastEntry = new Date(close.getTime() - settings.lastEntryMinutesBeforeClose * MINUTE_MS);
  return { businessDate, open, close, lastEntry };
}

function isClosedDay(settings: ShopSettings, businessDate: string): boolean {
  return (
    settings.closedDates.includes(businessDate) ||
    settings.closedWeekdays.includes(weekdayOf(businessDate))
  );
}

/**
 * 開始時刻がどの営業日の営業時間に入るかを探す。深夜（24時以降）は前日の営業日になる。
 */
export function findBusinessWindow(
  settings: ShopSettings,
  start: Date,
): BusinessWindow | null {
  const today = toJst(start).date;
  for (const date of [addDays(today, -1), today]) {
    const w = businessWindow(settings, date);
    if (start >= w.open && start < w.close) return w;
  }
  return null;
}

/** 区間内で同時にいる人数の最大値 */
export function peakOccupancy(range: Interval, occupancy: Occupancy[]): number {
  const events: [number, number][] = [];
  for (const o of occupancy) {
    const s = Math.max(o.start.getTime(), range.start.getTime());
    const e = Math.min(o.end.getTime(), range.end.getTime());
    if (s < e) {
      events.push([s, o.partySize], [e, -o.partySize]);
    }
  }
  // 同時刻なら退店（負）を先に処理する
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of events) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function checkAvailability(input: AvailabilityInput): AvailabilityResult {
  const { settings, now, start, partySize } = input;
  if (start <= now) return { ok: false, reason: "past", businessDate: null };

  const window = findBusinessWindow(settings, start);
  if (!window) return { ok: false, reason: "outside_hours", businessDate: null };
  const { businessDate } = window;

  if (start.getTime() - now.getTime() < settings.minLeadMinutes * MINUTE_MS) {
    return { ok: false, reason: "too_soon", businessDate };
  }
  if (start.getTime() - now.getTime() > settings.maxAdvanceDays * DAY_MS) {
    return { ok: false, reason: "too_far", businessDate };
  }
  if (isClosedDay(settings, businessDate)) {
    return { ok: false, reason: "closed_day", businessDate };
  }
  if (start > window.lastEntry) {
    return { ok: false, reason: "outside_hours", businessDate };
  }
  if (partySize > settings.maxPartySize) {
    return { ok: false, reason: "party_too_large", businessDate };
  }

  const end = new Date(
    Math.min(start.getTime() + settings.stayMinutes * MINUTE_MS, window.close.getTime()),
  );
  const range = { start, end };
  if (input.blocks.some((b) => overlaps(b, range))) {
    return { ok: false, reason: "blocked", businessDate };
  }
  if (peakOccupancy(range, input.occupancy) + partySize > settings.capacity) {
    return { ok: false, reason: "full", businessDate };
  }
  return { ok: true, start, end, businessDate };
}

/**
 * 満席などのとき、同じ営業日で希望時刻に近い空き時間（30分刻み）を提案する。
 */
export function suggestAlternatives(input: AvailabilityInput, limit = 3): Date[] {
  const window = findBusinessWindow(input.settings, input.start);
  if (!window) return [];
  const step = 30 * MINUTE_MS;
  const candidates: Date[] = [];
  for (let t = window.open.getTime(); t <= window.lastEntry.getTime(); t += step) {
    if (t !== input.start.getTime()) candidates.push(new Date(t));
  }
  const target = input.start.getTime();
  candidates.sort((a, b) => Math.abs(a.getTime() - target) - Math.abs(b.getTime() - target));
  const result: Date[] = [];
  for (const c of candidates) {
    if (checkAvailability({ ...input, start: c }).ok) result.push(c);
    if (result.length >= limit) break;
  }
  return result.sort((a, b) => a.getTime() - b.getTime());
}

export interface SlotAvailability {
  start: Date;
  /** 営業日基準の時刻 "HH:MM"（深夜は24以上） */
  clock: string;
  /** その時刻から標準滞在時間いた場合に、あと何人入れるか */
  remaining: number;
}

/**
 * 営業日の空き状況を1時間ごとに出す（SNS投稿用）。受付できない時間（過去・休業など）は除く。
 */
export function availabilityBoard(
  input: Omit<AvailabilityInput, "start" | "partySize">,
  businessDate: string,
  stepMinutes = 60,
): SlotAvailability[] {
  const openMin = parseClock(input.settings.openTime) ?? 0;
  let closeMin = parseClock(input.settings.closeTime) ?? 0;
  if (closeMin <= openMin) closeMin += 24 * 60;
  const lastEntry = closeMin - input.settings.lastEntryMinutesBeforeClose;
  const slots: SlotAvailability[] = [];
  for (let t = openMin; t <= lastEntry; t += stepMinutes) {
    const clock = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    const start = fromJst(businessDate, clock);
    const result = checkAvailability({ ...input, start, partySize: 1 });
    if (result.ok) {
      const remaining = input.settings.capacity - peakOccupancy({ start, end: result.end }, input.occupancy);
      slots.push({ start, clock, remaining: Math.max(0, remaining) });
    } else if (result.reason === "full" || result.reason === "blocked") {
      slots.push({ start, clock, remaining: 0 });
    }
  }
  return slots;
}
