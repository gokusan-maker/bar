import { saleTotal } from "./sales";
import type { Customer, Reservation, Sale } from "./types";

export interface CustomerSummary {
  customer: Customer;
  /** 来店済みの予約 ＋ 予約なしで登録した売上 */
  visits: number;
  noShows: number;
  /** 最終来店の営業日 "YYYY-MM-DD" */
  lastVisit: string | null;
  totalSpend: number;
  /** 今後の予約（承認待ち・確定） */
  upcoming: number;
}

export function summarizeCustomers(
  customers: Customer[],
  reservations: Reservation[],
  sales: Sale[],
  businessDate: (r: Reservation) => string,
  now: Date,
): CustomerSummary[] {
  const byId = new Map<string, CustomerSummary>(
    customers.map((c) => [
      c.id,
      { customer: c, visits: 0, noShows: 0, lastVisit: null, totalSpend: 0, upcoming: 0 },
    ]),
  );
  const seen = (s: CustomerSummary, date: string) => {
    if (!s.lastVisit || date > s.lastVisit) s.lastVisit = date;
  };
  for (const r of reservations) {
    const s = byId.get(r.customerId);
    if (!s) continue;
    if (r.status === "visited") {
      s.visits++;
      seen(s, businessDate(r));
    } else if (r.status === "no_show") {
      s.noShows++;
    } else if ((r.status === "pending" || r.status === "confirmed") && new Date(r.startAt) > now) {
      s.upcoming++;
    }
  }
  for (const sale of sales) {
    const s = sale.customerId ? byId.get(sale.customerId) : undefined;
    if (!s) continue;
    s.totalSpend += saleTotal(sale);
    seen(s, sale.businessDate);
    // 予約に紐づく売上は来店済み予約として数え済み
    if (!sale.reservationId) s.visits++;
  }
  return [...byId.values()];
}

/** 「常連, VIP、ワイン好き」→ ["常連", "VIP", "ワイン好き"]（重複なし・最大10個・各20文字） */
export function parseTags(input: string): string[] {
  const tags = input
    .normalize("NFKC")
    .split(/[,、，\s#]+/)
    .map((t) => t.trim().slice(0, 20))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 10);
}

/** 「5/3」「05-03」「1990/5/3」「5月3日」→ "05-03"。読めなければ null */
export function parseBirthday(input: string): string | null {
  const m = input.normalize("NFKC").match(/(?:\d{4}\D+)?(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const daysIn = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysIn[month - 1]) return null;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "05-03" → "5月3日" */
export const birthdayLabel = (birthday: string) => {
  const [m, d] = birthday.split("-").map(Number);
  return `${m}月${d}日`;
};

/** 電話番号を数字だけにする（10〜11桁でなければ null） */
export function parsePhone(input: string): string | null {
  const digits = input.normalize("NFKC").replace(/\D/g, "");
  return /^0\d{9,10}$/.test(digits) ? digits : null;
}

/** 090-1234-5678 / 03-1234-5678 の形で表示する */
export function phoneLabel(phone: string): string {
  if (/^0[5789]0\d{8}$/.test(phone)) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
  if (/^0\d{9}$/.test(phone)) return `${phone.slice(0, 2)}-${phone.slice(2, 6)}-${phone.slice(6)}`;
  return phone;
}

export interface CustomerFilter {
  channel?: string;
  staffId?: string;
  tag?: string;
  /** "01"〜"12"。その月が誕生日のお客様 */
  birthdayMonth?: string;
}

export function filterCustomers<T extends { customer: Customer }>(rows: T[], f: CustomerFilter): T[] {
  return rows.filter(
    ({ customer: c }) =>
      (!f.channel || c.channel === f.channel) &&
      (!f.staffId || (f.staffId === "none" ? !c.staffId : c.staffId === f.staffId)) &&
      (!f.tag || c.tags.includes(f.tag)) &&
      (!f.birthdayMonth || c.birthday?.startsWith(`${f.birthdayMonth}-`)),
  );
}
