import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { CUSTOMER_SORTS, customerList, type CustomerListParams } from "@/lib/customer-list";
import { birthdayLabel, phoneLabel } from "@/lib/domain/customers";
import { yen } from "@/lib/domain/sales";
import { toJst } from "@/lib/domain/time";
import { CHANNEL_LABEL } from "../ui";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<CustomerListParams> }) {
  await requireAdmin();
  const p = await searchParams;
  const { rows, total, tags, staff } = await customerList(p);
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const thisMonth = toJst(new Date()).date.slice(5, 7);
  const query = new URLSearchParams(Object.entries(p).filter(([k, v]) => v && k !== "saved") as [string, string][]).toString();

  return (
    <>
      <div className="row spread">
        <h1 style={{ margin: 0 }}>お客様リスト</h1>
        <Link className="button primary" href="/admin/customers/new">
          ＋ お客様を登録
        </Link>
      </div>
      <form className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <input name="q" defaultValue={p.q} placeholder="名前・電話番号で検索" aria-label="名前・電話番号で検索" style={{ flex: 2, minWidth: 160 }} />
          <select name="sort" defaultValue={p.sort ?? "recent"} aria-label="並び順" style={{ flex: 1, minWidth: 140 }}>
            {Object.entries(CUSTOMER_SORTS).map(([key, s]) => (
              <option key={key} value={key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <select name="channel" defaultValue={p.channel ?? ""} aria-label="集客経路" style={{ flex: 1, minWidth: 120 }}>
            <option value="">すべての経路</option>
            {(["line", "instagram", "x", "web", "manual"] as const).map((c) => (
              <option key={c} value={c}>
                {c === "manual" ? "SNS以外" : CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
          <select name="staff" defaultValue={p.staff ?? ""} aria-label="担当" style={{ flex: 1, minWidth: 120 }}>
            <option value="">すべての担当</option>
            <option value="none">担当なし</option>
            {staff
              .filter((s) => !s.pending)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          {tags.length > 0 && (
            <select name="tag" defaultValue={p.tag ?? ""} aria-label="タグ" style={{ flex: 1, minWidth: 120 }}>
              <option value="">すべてのタグ</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <select name="away" defaultValue={p.away ?? ""} aria-label="最終来店" style={{ flex: 1, minWidth: 120 }}>
            <option value="">最終来店：すべて</option>
            <option value="30">30日以上来ていない</option>
            <option value="60">60日以上来ていない</option>
            <option value="90">90日以上来ていない</option>
          </select>
          <select name="bday" defaultValue={p.bday ?? ""} aria-label="誕生月" style={{ flex: 1, minWidth: 120 }}>
            <option value="">誕生月：すべて</option>
            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
              <option key={m} value={m}>
                {Number(m)}月生まれ{m === thisMonth ? "（今月）" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button type="submit" className="primary">
            表示
          </button>
          <Link className="button" href={`/admin/customers?bday=${thisMonth}&sort=birthday`}>
            今月が誕生日
          </Link>
          <Link className="button" href="/admin/customers?away=60&sort=visits">
            ご無沙汰の常連
          </Link>
          <Link className="button" href="/admin/customers">
            条件をクリア
          </Link>
        </div>
      </form>

      <div className="row spread">
        <p className="muted" style={{ margin: 0 }}>
          {rows.length}人{rows.length !== total && `（全${total}人中）`}
        </p>
        <div className="row">
          <Link className="button" href={`/print/customers${query ? `?${query}` : ""}`}>
            PDF（印刷）
          </Link>
          <a className="button" href="/api/export?kind=customers">
            CSV
          </a>
        </div>
      </div>
      <section className="card">
        {rows.length === 0 ? (
          <p className="muted">該当するお客様はいません</p>
        ) : (
          <ul className="list">
            {rows.map((s) => (
              <li key={s.customer.id}>
                <div className="row spread">
                  <Link href={`/admin/customers/${s.customer.id}`}>{s.customer.name ?? s.customer.displayName ?? "名前未設定"}</Link>
                  <span className="muted">
                    {CHANNEL_LABEL[s.customer.channel]}
                    {s.customer.staffId && ` ・ 担当 ${staffName.get(s.customer.staffId) ?? ""}`}
                  </span>
                </div>
                <div className="muted">
                  来店 {s.visits}回 ・ 最終 {s.lastVisit ?? "—"} ・ {yen(s.totalSpend)}
                  {s.upcoming > 0 && ` ・ 予約 ${s.upcoming}件`}
                  {s.noShows > 0 && <span style={{ color: "var(--danger)" }}> ・ 無断キャンセル {s.noShows}回</span>}
                  {s.customer.phone && (
                    <>
                      {" ・ "}
                      <a href={`tel:${s.customer.phone}`}>{phoneLabel(s.customer.phone)}</a>
                    </>
                  )}
                  {s.customer.birthday && ` ・ 🎂 ${birthdayLabel(s.customer.birthday)}`}
                </div>
                {s.customer.tags.length > 0 && (
                  <div className="row" style={{ gap: 4, marginTop: 4 }}>
                    {s.customer.tags.map((t) => (
                      <Link key={t} className="badge" href={`/admin/customers?tag=${encodeURIComponent(t)}`}>
                        {t}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
