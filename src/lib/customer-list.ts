import "server-only";
import { repository } from "./container";
import { filterCustomers, summarizeCustomers, type CustomerSummary } from "./domain/customers";
import { addDays, toJst } from "./domain/time";
import { businessDateOf } from "./reservation-service";

export const CUSTOMER_SORTS: Record<string, { label: string; compare: (a: CustomerSummary, b: CustomerSummary) => number }> = {
  recent: { label: "最終来店が新しい順", compare: (a, b) => (b.lastVisit ?? "").localeCompare(a.lastVisit ?? "") },
  visits: { label: "来店回数が多い順", compare: (a, b) => b.visits - a.visits },
  spend: { label: "利用金額が多い順", compare: (a, b) => b.totalSpend - a.totalSpend },
  created: { label: "登録が新しい順", compare: (a, b) => b.customer.createdAt.localeCompare(a.customer.createdAt) },
  birthday: { label: "誕生日順", compare: (a, b) => (a.customer.birthday ?? "99").localeCompare(b.customer.birthday ?? "99") },
};

export type CustomerListParams = {
  q?: string;
  sort?: string;
  channel?: string;
  staff?: string;
  tag?: string;
  bday?: string;
  /** 最終来店からの日数（30・60・90） */
  away?: string;
  saved?: string;
};

/** お客様リストの絞り込み（印刷ページと共通） */
export async function customerList(p: CustomerListParams) {
  const repo = repository();
  const [customers, reservations, sales, staff, settings] = await Promise.all([
    repo.listCustomers({ search: p.q ?? "", limit: 2000 }),
    repo.listReservations({}),
    repo.listSales({}),
    repo.listStaff(),
    repo.getSettings(),
  ]);
  const order = CUSTOMER_SORTS[p.sort ?? ""] ?? CUSTOMER_SORTS.recent;
  const all = summarizeCustomers(
    // テスト送信のお客様と、自動削除で名前が消えたお客様は出さない
    customers.filter((c) => c.channel !== "simulator" && (c.name || c.displayName)),
    reservations,
    sales,
    (r) => businessDateOf(r, settings),
    new Date(),
  );
  const awayDays = Number(p.away);
  const lastVisitBefore = [30, 60, 90].includes(awayDays) ? addDays(toJst(new Date()).date, -awayDays) : undefined;
  const rows = filterCustomers(all, { channel: p.channel, staffId: p.staff, tag: p.tag, birthdayMonth: p.bday, lastVisitBefore }).sort(
    order.compare,
  );
  const tags = [...new Set(all.flatMap((r) => r.customer.tags))].sort((a, b) => a.localeCompare(b, "ja"));
  return { rows, total: all.length, tags, staff, settings };
}

