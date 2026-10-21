import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { repository, salesService } from "@/lib/container";
import { isSnsChannel, monthRange, saleTotal, shiftMonth, yen } from "@/lib/domain/sales";
import { percent, reservationStats } from "@/lib/domain/stats";
import { fromJst, toJst, weekdayJa, weekdayOf } from "@/lib/domain/time";
import { businessDateOf } from "@/lib/reservation-service";
import type { Channel } from "@/lib/domain/types";
import { CHANNEL_LABEL } from "../ui";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; deleted?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const thisMonth = toJst(new Date()).date.slice(0, 7);
  const month = params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : thisMonth;
  const repo = repository();
  const { first, last } = monthRange(month);
  const [report, sales, staff, settings, reservations] = await Promise.all([
    salesService().report(month),
    repo.listSales({ fromDate: first, toDate: last }),
    repo.listStaff(),
    repo.getSettings(),
    repo.listReservations({ from: fromJst(first, "06:00"), to: fromJst(last, "30:00") }),
  ]);
  // 営業日がその月のものだけ（深夜帯は前日扱い）
  const monthReservations = reservations.filter((r) => businessDateOf(r, settings).startsWith(month));
  const stats = reservationStats(monthReservations, (r) => weekdayOf(businessDateOf(r, settings)));
  const maxWeekday = Math.max(1, ...stats.byWeekday);
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const [y, m] = month.split("-").map(Number);
  const channels: Channel[] = ["line", "instagram", "x", "web", "manual"];
  if (report.byChannel.simulator.count) channels.splice(2, 0, "simulator");

  return (
    <>
      {params.deleted && <p className="notice success">削除しました</p>}
      <div className="row spread" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>
          {y}年{m}月の売上・バック
        </h1>
        <div className="row">
          <Link className="button" href={`/admin/sales?month=${shiftMonth(month, -1)}`}>
            ← 前月
          </Link>
          <Link className="button" href={`/admin/sales?month=${shiftMonth(month, 1)}`}>
            翌月 →
          </Link>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="muted">総売上</div>
          <div className="value">{yen(report.all.total)}</div>
          <div className="muted">
            {report.all.count}組 {report.all.guests}名
          </div>
        </div>
        <div className="stat">
          <div className="muted">SNS経由の売上</div>
          <div className="value">{yen(report.sns.total)}</div>
          <div className="muted">
            {report.sns.count}組 {report.sns.guests}名
          </div>
        </div>
        <div className="stat">
          <div className="muted">バック合計</div>
          <div className="value">{yen(report.backTotal)}</div>
          <div className="muted">{settings.backTarget === "sns" ? "SNS経由の売上が対象" : "全売上が対象"}</div>
        </div>
      </div>

      <section className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>スタッフ別バック</h2>
          <div className="row">
            <a className="button" href={`/api/reports/monthly?month=${month}`}>
              CSV
            </a>
            <Link className="button" href={`/print/back?month=${month}`}>
              PDF
            </Link>
          </div>
        </div>
        {report.staff.length === 0 ? (
          <p className="muted">
            スタッフが登録されていません。<Link href="/admin/staff">スタッフを登録</Link>
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>スタッフ</th>
                  <th>組数</th>
                  <th>対象売上</th>
                  <th>バック率</th>
                  <th>率によるバック</th>
                  <th>固定</th>
                  <th>バック合計</th>
                </tr>
              </thead>
              <tbody>
                {report.staff.map((r) => (
                  <tr key={r.staff.id}>
                    <td>{r.staff.name}</td>
                    <td>{r.sales.count}</td>
                    <td>{yen(r.sales.total)}</td>
                    <td>{r.staff.backRates.rate}%</td>
                    <td>{yen(r.back.byRate)}</td>
                    <td>{yen(r.back.perVisit)}</td>
                    <td>
                      <strong>{yen(r.back.total)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>経路別・項目別</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>経路</th>
                <th>組数</th>
                <th>お酒</th>
                <th>料金</th>
                <th>サービス料</th>
                <th>合計</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => {
                const t = report.byChannel[c];
                return (
                  <tr key={c}>
                    <td>{c === "manual" ? "SNS以外" : CHANNEL_LABEL[c]}</td>
                    <td>{t.count}</td>
                    <td>{yen(t.drink)}</td>
                    <td>{yen(t.charge)}</td>
                    <td>{yen(t.service)}</td>
                    <td>{yen(t.total)}</td>
                  </tr>
                );
              })}
              <tr>
                <td>
                  <strong>合計</strong>
                </td>
                <td>{report.all.count}</td>
                <td>{yen(report.all.drink)}</td>
                <td>{yen(report.all.charge)}</td>
                <td>{yen(report.all.service)}</td>
                <td>
                  <strong>{yen(report.all.total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>予約の集計</h2>
        <div className="stats">
          <div>
            <div className="muted">受付</div>
            <div className="value-sm">{stats.total}件</div>
          </div>
          <div>
            <div className="muted">SNS経由</div>
            <div className="value-sm">{percent(stats.snsShare)}</div>
          </div>
          <div>
            <div className="muted">無断キャンセル率</div>
            <div className="value-sm">{percent(stats.noShowRate)}</div>
          </div>
          <div>
            <div className="muted">キャンセル率</div>
            <div className="value-sm">{percent(stats.cancelRate)}</div>
          </div>
          <div>
            <div className="muted">平均人数（来店）</div>
            <div className="value-sm">
              {stats.averageParty === null ? "—" : `${Math.round(stats.averageParty * 10) / 10}名`}
            </div>
          </div>
        </div>
        <p className="muted" style={{ margin: "4px 0" }}>
          来店 {stats.byStatus.visited} ・ 確定 {stats.byStatus.confirmed} ・ 承認待ち {stats.byStatus.pending} ・ 無断{" "}
          {stats.byStatus.no_show} ・ キャンセル {stats.byStatus.cancelled} ・ お断り {stats.byStatus.rejected}
        </p>
        <div className="bars" aria-label="曜日別の予約数">
          {stats.byWeekday.map((n, d) => (
            <div key={d} className="bar-col">
              <div className="bar-value">{n}</div>
              <div className="bar" style={{ height: `${(n / maxWeekday) * 60}px` }} />
              <div className="muted">{weekdayJa(d)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>売上の明細（{sales.length}件）</h2>
          <Link className="button primary" href="/admin/sales/new">
            売上を登録
          </Link>
        </div>
        <ul className="list">
          {sales.map((s) => (
            <li key={s.id} className="row spread">
              <Link href={`/admin/sales/${s.id}`}>
                {s.businessDate.slice(5).replace("-", "/")} {s.customerName ?? "お客様"} {s.partySize}名
              </Link>
              <span className="muted">
                {isSnsChannel(s.channel) ? CHANNEL_LABEL[s.channel] : "SNS以外"}
                {s.staffId && ` ・ ${staffName.get(s.staffId) ?? ""}`}
              </span>
              <strong>{yen(saleTotal(s))}</strong>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
