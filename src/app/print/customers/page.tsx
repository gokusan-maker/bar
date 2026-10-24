import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { customerList, type CustomerListParams } from "@/lib/customer-list";
import { birthdayLabel, phoneLabel } from "@/lib/domain/customers";
import { yen } from "@/lib/domain/sales";
import { toJst } from "@/lib/domain/time";
import { CHANNEL_LABEL } from "@/lib/domain/types";
import { PrintButton } from "../back/print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "お客様リスト", robots: { index: false } };

/** お客様リストの印刷用ページ（一覧画面の絞り込みをそのまま使う） */
export default async function CustomersPrintPage({ searchParams }: { searchParams: Promise<CustomerListParams> }) {
  await requireAdmin();
  const p = await searchParams;
  const { rows, staff, settings } = await customerList(p);
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const query = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  const conditions = [
    p.q && `「${p.q}」`,
    p.channel && (p.channel === "manual" ? "SNS以外" : CHANNEL_LABEL[p.channel as keyof typeof CHANNEL_LABEL]),
    p.staff && (p.staff === "none" ? "担当なし" : `担当 ${staffName.get(p.staff) ?? ""}`),
    p.tag && `タグ ${p.tag}`,
    p.bday && `${Number(p.bday)}月生まれ`,
  ].filter(Boolean);

  return (
    <main className="print-sheet">
      <div className="no-print row" style={{ marginBottom: 16 }}>
        <Link className="button" href={`/admin/customers${query ? `?${query}` : ""}`}>
          ← お客様リストに戻る
        </Link>
        <PrintButton />
      </div>
      <p className="no-print muted">印刷画面で送信先に「PDFに保存」を選ぶとPDFになります。個人情報なので取り扱いにご注意ください。</p>
      <h1>お客様リスト</h1>
      <p>
        {settings.shopName}　／　作成日 {toJst(new Date()).date.replaceAll("-", "/")}　／　{rows.length}人
        {conditions.length > 0 && `　／　条件：${conditions.join("・")}`}
      </p>
      <table>
        <thead>
          <tr>
            <th>お名前</th>
            <th>電話番号</th>
            <th>誕生日</th>
            <th>経路</th>
            <th>担当</th>
            <th>来店</th>
            <th>最終来店</th>
            <th>利用金額</th>
            <th>タグ・メモ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ customer: c, visits, lastVisit, totalSpend }) => (
            <tr key={c.id}>
              <td>{c.name ?? c.displayName}</td>
              <td>{c.phone ? phoneLabel(c.phone) : ""}</td>
              <td>{c.birthday ? birthdayLabel(c.birthday) : ""}</td>
              <td>{c.channel === "manual" ? "SNS以外" : CHANNEL_LABEL[c.channel]}</td>
              <td>{c.staffId ? staffName.get(c.staffId) : ""}</td>
              <td>{visits}回</td>
              <td>{lastVisit?.replaceAll("-", "/") ?? ""}</td>
              <td>{yen(totalSpend)}</td>
              <td style={{ whiteSpace: "normal" }}>{[c.tags.join("・"), c.note].filter(Boolean).join(" ／ ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
