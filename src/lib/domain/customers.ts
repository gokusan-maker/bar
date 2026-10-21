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
