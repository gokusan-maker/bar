import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { repository } from "@/lib/container";
import { summarizeCustomers, type CustomerSummary } from "@/lib/domain/customers";
import { yen } from "@/lib/domain/sales";
import { businessDateOf } from "@/lib/reservation-service";
import { CHANNEL_LABEL } from "../ui";

const SORTS: Record<string, { label: string; compare: (a: CustomerSummary, b: CustomerSummary) => number }> = {
  recent: { label: "最終来店が新しい順", compare: (a, b) => (b.lastVisit ?? "").localeCompare(a.lastVisit ?? "") },
  visits: { label: "来店回数が多い順", compare: (a, b) => b.visits - a.visits },
  spend: { label: "利用金額が多い順", compare: (a, b) => b.totalSpend - a.totalSpend },
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string }>;
}) {
  await requireAdmin();
  const { q = "", sort = "recent" } = await searchParams;
  const repo = repository();
  const [customers, reservations, sales, staff, settings] = await Promise.all([
    repo.listCustomers({ search: q, limit: 500 }),
    repo.listReservations({}),
    repo.listSales({}),
    repo.listStaff(),
    repo.getSettings(),
  ]);
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const order = SORTS[sort] ?? SORTS.recent;
  const rows = summarizeCustomers(
    // テスト送信のお客様は一覧に出さない
    customers.filter((c) => c.channel !== "simulator"),
    reservations,
    sales,
    (r) => businessDateOf(r, settings),
    new Date(),
  ).sort(order.compare);

  return (
    <>
      <h1>お客様</h1>
      <form className="row" style={{ marginBottom: 12 }}>
        <input name="q" defaultValue={q} placeholder="名前で検索" aria-label="名前で検索" style={{ flex: 2, minWidth: 0 }} />
        <select name="sort" defaultValue={sort} aria-label="並び順" style={{ flex: 1, minWidth: 0 }}>
          {Object.entries(SORTS).map(([key, s]) => (
            <option key={key} value={key}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="submit">表示</button>
      </form>
      <section className="card">
        {rows.length === 0 ? (
          <p className="muted">該当するお客様はいません</p>
        ) : (
          <ul className="list">
            {rows.map((s) => (
              <li key={s.customer.id}>
                <div className="row spread">
                  <Link href={`/admin/customers/${s.customer.id}`}>
                    {s.customer.name ?? s.customer.displayName ?? "名前未設定"}
                  </Link>
                  <span className="muted">
                    {CHANNEL_LABEL[s.customer.channel]}
                    {s.customer.staffId && ` ・ 担当 ${staffName.get(s.customer.staffId) ?? ""}`}
                  </span>
                </div>
                <div className="muted">
                  来店 {s.visits}回 ・ 最終 {s.lastVisit ?? "—"} ・ {yen(s.totalSpend)}
                  {s.upcoming > 0 && ` ・ 予約 ${s.upcoming}件`}
                  {s.noShows > 0 && <span style={{ color: "var(--danger)" }}> ・ 無断キャンセル {s.noShows}回</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
