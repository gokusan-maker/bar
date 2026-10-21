import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { repository } from "@/lib/container";
import { backForSale, isBackTarget, saleTotal, yen } from "@/lib/domain/sales";
import { formatJa } from "@/lib/domain/time";
import { EvidenceInput } from "../../evidence-input";
import { deleteAttachmentAction, deleteSaleAction, uploadEvidenceAction } from "../../sales-actions";
import { HistoryList } from "../../history-list";
import { SaleForm } from "../sale-form";

export default async function SalePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved, error } = await searchParams;
  const repo = repository();
  const sale = await repo.getSale(id);
  if (!sale) notFound();
  const [settings, staff, attachments, logs] = await Promise.all([
    repo.getSettings(),
    repo.listStaff(),
    repo.listAttachments(id),
    repo.listAudit({ targetId: id, limit: 50 }),
  ]);
  const member = staff.find((s) => s.id === sale.staffId);
  const back = member && isBackTarget(sale, settings) ? backForSale(sale, member.backRates) : null;

  return (
    <>
      {saved && <p className="notice success">保存しました</p>}
      {error && <p className="notice error">{error}</p>}
      <div className="row spread">
        <h1 style={{ margin: 0 }}>売上 {yen(saleTotal(sale))}</h1>
        <Link href={`/admin/sales?month=${sale.businessDate.slice(0, 7)}`}>← {sale.businessDate.slice(0, 7)}の売上</Link>
      </div>
      <p className="muted">
        {sale.businessDate} ・ {sale.customerName ?? "お客様"} {sale.partySize}名
        {sale.reservationId && (
          <>
            {" ・ "}
            <Link href={`/admin/reservations/${sale.reservationId}`}>予約を見る</Link>
          </>
        )}
      </p>
      <section className="card">
        <strong>バック: </strong>
        {back ? (
          <>
            {member!.name}さんに {yen(back.total)}
            <span className="muted">
              {" "}
              （売上全体 {yen(saleTotal(sale))} × {member!.backRates.rate}% ＝ {yen(back.byRate)}{back.perVisit ? ` ＋ 固定 ${yen(back.perVisit)}` : ""}）
            </span>
          </>
        ) : (
          <span className="muted">
            {!member ? "担当スタッフなし" : "SNS経由ではないため対象外（設定で変更できます）"}
          </span>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>証拠（{attachments.length}件）</h2>
        {attachments.length === 0 && <p className="muted">伝票やレシートの写真を添付しておくと、後から確認できます。</p>}
        <div className="thumbs">
          {attachments.map((a) => (
            <figure key={a.id} className="thumb">
              <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener">
                {a.contentType.startsWith("image/") && a.contentType !== "image/heic" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 認証付きAPIから配信するため
                  <img src={`/api/attachments/${a.id}`} alt={a.fileName} />
                ) : (
                  <span className="file-icon">{a.contentType === "application/pdf" ? "PDF" : "写真"}</span>
                )}
              </a>
              <figcaption>
                <span className="muted">{formatJa(new Date(a.createdAt))}</span>
                <form action={deleteAttachmentAction} className="inline">
                  <input type="hidden" name="saleId" value={sale.id} />
                  <input type="hidden" name="attachmentId" value={a.id} />
                  <button type="submit" className="danger small">
                    削除
                  </button>
                </form>
              </figcaption>
            </figure>
          ))}
        </div>
        <form action={uploadEvidenceAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="saleId" value={sale.id} />
          <EvidenceInput label="写真・PDFを追加" />
          <button type="submit">添付する</button>
        </form>
      </section>

      <h2>内容を修正</h2>
      <SaleForm
        id={sale.id}
        values={{ ...sale, serviceAmount: sale.serviceAmount }}
        staff={staff}
        settings={settings}
        withFiles={false}
      />

      <section className="card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>履歴</h2>
        <HistoryList logs={logs} links={false} />
      </section>

      <form action={deleteSaleAction} style={{ marginTop: 24 }}>
        <input type="hidden" name="id" value={sale.id} />
        <label>
          <input type="checkbox" name="confirm" required />
          削除すると元に戻せないことを確認しました
        </label>
        <button type="submit" className="danger">
          この売上を削除（添付も削除されます）
        </button>
      </form>
    </>
  );
}
