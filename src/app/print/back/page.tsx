import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { repository, salesService } from "@/lib/container";
import { backForSale, isBackTarget, monthRange, saleTotal, yen } from "@/lib/domain/sales";
import { toJst } from "@/lib/domain/time";
import { CHANNEL_LABEL } from "@/lib/domain/types";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "スタッフ別バック明細", robots: { index: false } };

/** スタッフ別バックの印刷用ページ。ブラウザの「PDFに保存」でPDFにする */
export default async function BackPrintPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const { month: m } = await searchParams;
  const month = m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : toJst(new Date()).date.slice(0, 7);
  const repo = repository();
  const { first, last } = monthRange(month);
  const [report, settings, sales] = await Promise.all([
    salesService().report(month),
    repo.getSettings(),
    repo.listSales({ fromDate: first, toDate: last }),
  ]);
  const [y, mo] = month.split("-").map(Number);
  const now = toJst(new Date());

  return (
    <main className="print-sheet">
      <div className="no-print row" style={{ marginBottom: 16 }}>
        <Link className="button" href={`/admin/sales?month=${month}`}>
          ← 売上に戻る
        </Link>
        <PrintButton />
      </div>
      <p className="no-print muted">
        印刷画面で送信先（プリンター）に「PDFに保存」を選ぶとPDFになります。スマホでは共有メニューの「プリント」からPDFにできます。
      </p>

      <h1>
        {y}年{mo}月 スタッフ別バック明細
      </h1>
      <p>
        {settings.shopName}　／　作成日 {now.date.replaceAll("-", "/")}　／　対象：
        {settings.backTarget === "all" ? "すべての売上" : "SNS経由の売上"}
      </p>
      <p className="muted">バック ＝ 売上全体（お酒＋料金＋サービス料）× バック率（円未満切り捨て）＋ 1組ごとの固定バック</p>

      <table>
        <thead>
          <tr>
            <th>スタッフ</th>
            <th>バック率</th>
            <th>組数</th>
            <th>人数</th>
            <th>対象売上</th>
            <th>率によるバック</th>
            <th>固定</th>
            <th>バック合計</th>
          </tr>
        </thead>
        <tbody>
          {report.staff.map((r) => (
            <tr key={r.staff.id}>
              <td>{r.staff.name}</td>
              <td>{r.staff.backRates.rate}%</td>
              <td>{r.sales.count}</td>
              <td>{r.sales.guests}</td>
              <td>{yen(r.sales.total)}</td>
              <td>{yen(r.back.byRate)}</td>
              <td>{yen(r.back.perVisit)}</td>
              <td>
                <strong>{yen(r.back.total)}</strong>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={7}>
              <strong>合計</strong>
            </td>
            <td>
              <strong>{yen(report.backTotal)}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      {report.staff
        .filter((r) => r.sales.count > 0)
        .map((r) => {
          const rows = sales
            .filter((s) => s.staffId === r.staff.id && isBackTarget(s, settings))
            .sort((a, b) => a.businessDate.localeCompare(b.businessDate));
          return (
            <section key={r.staff.id} className="print-staff">
              <h2>
                {r.staff.name}　バック合計 {yen(r.back.total)}
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>営業日</th>
                    <th>お客様</th>
                    <th>経路</th>
                    <th>人数</th>
                    <th>売上全体</th>
                    <th>バック</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td>{s.businessDate.slice(5).replace("-", "/")}</td>
                      <td>{s.customerName ?? "—"}</td>
                      <td>{s.channel === "manual" ? "SNS以外" : CHANNEL_LABEL[s.channel]}</td>
                      <td>{s.partySize}</td>
                      <td>{yen(saleTotal(s))}</td>
                      <td>{yen(backForSale(s, r.staff.backRates).total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
    </main>
  );
}
