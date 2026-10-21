/**
 * 日本時間（JST, UTC+9, サマータイムなし）の日時ヘルパー。
 * サーバーはUTCで動くことが多いので、Date のローカル時刻系メソッドは使わない。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

export interface JstParts {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  time: string;
  /** 0=日曜 ... 6=土曜 */
  weekday: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toJst(at: Date): JstParts {
  const shifted = new Date(at.getTime() + JST_OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    weekday: shifted.getUTCDay(),
  };
}

/** "HH:MM"（24以上も可）を分に変換。不正なら null */
export function parseClock(clock: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min >= 60 || h > 47) return null;
  return h * 60 + min;
}

export function isValidDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/**
 * JSTの日付と時刻からDateを作る。時刻は "25:30" のように24時以降も受け付け、翌日として扱う。
 */
export function fromJst(date: string, clock: string): Date {
  const minutes = parseClock(clock);
  if (!isValidDate(date) || minutes === null) {
    throw new Error(`invalid JST date/time: ${date} ${clock}`);
  }
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d) - JST_OFFSET_MS + minutes * MINUTE_MS);
}

export function addDays(date: string, days: number): string {
  return toJst(new Date(fromJst(date, "00:00").getTime() + days * DAY_MS)).date;
}

export function weekdayOf(date: string): number {
  return toJst(fromJst(date, "12:00")).weekday;
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** 例: "10/25(土) 21:00" */
export function formatJa(at: Date): string {
  const p = toJst(at);
  const [, mo, d] = p.date.split("-").map(Number);
  return `${mo}/${d}(${WEEKDAY_JA[p.weekday]}) ${p.time}`;
}

export function weekdayJa(weekday: number): string {
  return WEEKDAY_JA[weekday];
}
