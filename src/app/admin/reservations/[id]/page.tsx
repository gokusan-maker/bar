import Link from "next/link";
import { notFound } from "next/navigation";
import { currentRole } from "@/lib/auth";
import { repository } from "@/lib/container";
import { saleTotal, yen } from "@/lib/domain/sales";
import { canMessage } from "@/lib/domain/types";
import { formatJa, toJst } from "@/lib/domain/time";
import { businessDateOf, businessClockOf } from "@/lib/reservation-service";
import { editReservationAction, reservationAction } from "../../actions";
import { HistoryList } from "../../history-list";
import { CHANNEL_LABEL, ReservationActions, StatusBadge } from "../../ui";

export default async function ReservationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { id } = await params;
  const { done, error } = await searchParams;
  const owner = (await currentRole()) === "owner";
  const repo = repository();
  const r = await repo.getReservation(id);
  if (!r) notFound();
  const [customer, [sale], settings, logs] = await Promise.all([
    repo.getCustomer(r.customerId),
    repo.listSales({ reservationId: r.id }),
    repo.getSettings(),
    repo.listAudit({ targetId: r.id, limit: 50 }),
  ]);
  const active = r.status === "pending" || r.status === "confirmed";

  return (
    <>
      {done && <p className="notice success">更新しました</p>}
      {error && <p className="notice error">{error}</p>}
      <h1>
        {r.name}様 {r.partySize}名 <StatusBadge status={r.status} />
      </h1>
      <section className="card">
        <dl className="grid2" style={{ margin: 0 }}>
          <div>
            <dt className="muted">日時</dt>
            <dd style={{ margin: 0 }}>
              {formatJa(new Date(r.startAt))}〜{toJst(new Date(r.endAt)).time}
            </dd>
          </div>
          <div>
            <dt className="muted">受付</dt>
            <dd style={{ margin: 0 }}>{CHANNEL_LABEL[r.channel]}</dd>
          </div>
          <div>
            <dt className="muted">要望</dt>
            <dd style={{ margin: 0 }}>{r.notes ?? "なし"}</dd>
          </div>
          <div>
            <dt className="muted">Googleカレンダー</dt>
            <dd style={{ margin: 0 }}>{r.googleEventId ? "反映済み" : "未反映"}</dd>
          </div>
        </dl>
        {owner && customer && (
          <p style={{ marginBottom: 0 }}>
            <Link href={`/admin/customers/${customer.id}`}>
              {customer.displayName ?? customer.name ?? "お客様"}とのやり取りを見る →
            </Link>
          </p>
        )}
      </section>

      {owner && (sale || r.status === "confirmed" || r.status === "visited") && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>売上</h2>
          {sale ? (
            <Link href={`/admin/sales/${sale.id}`}>{yen(saleTotal(sale))}（明細・証拠写真を見る）</Link>
          ) : (
            <Link className="button primary" href={`/admin/sales/new?reservationId=${r.id}`}>
              売上を登録（来店済みにする）
            </Link>
          )}
        </section>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>操作</h2>
        {(owner || r.status === "confirmed") && <ReservationActions r={r} />}
        {owner && active && (
          <>
            <form action={reservationAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="op" value="cancel" />
              {canMessage(r.channel) && (
                <label>
                  <input type="checkbox" name="notify" defaultChecked />
                  お客様にキャンセルを連絡する
                </label>
              )}
              <button type="submit" className="danger">
                店の都合でキャンセル
              </button>
            </form>
            <details style={{ marginTop: 12 }}>
              <summary>日時・人数・名前を変更</summary>
              <form action={editReservationAction} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={r.id} />
                <div className="grid2">
                  <label>
                    来店日（営業日）
                    <input type="date" name="date" required defaultValue={businessDateOf(r, settings)} />
                  </label>
                  <label>
                    時刻（深夜1時は 25:00）
                    <input name="time" required pattern="\d{1,2}:\d{2}" defaultValue={businessClockOf(r, settings)} />
                  </label>
                  <label>
                    人数
                    <input type="number" name="partySize" min={1} required defaultValue={r.partySize} />
                  </label>
                  <label>
                    お名前
                    <input name="name" required defaultValue={r.name} />
                  </label>
                </div>
                <label>
                  要望・メモ
                  <textarea name="notes" rows={2} defaultValue={r.notes ?? ""} />
                </label>
                <label>
                  <input type="checkbox" name="force" />
                  満席・営業時間外でも変更する
                </label>
                {canMessage(r.channel) && (
                  <label>
                    <input type="checkbox" name="notify" defaultChecked />
                    日時・人数が変わったらお客様に連絡する
                  </label>
                )}
                <button type="submit" className="primary">
                  変更を保存
                </button>
              </form>
            </details>
            <form action={reservationAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="op" value="resync" />
              <button type="submit">Googleカレンダーに再反映</button>
            </form>
          </>
        )}
      </section>
      {owner && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>履歴</h2>
          <HistoryList logs={logs} links={false} />
        </section>
      )}
      <p className="muted">
        登録: {formatJa(new Date(r.createdAt))} / 更新: {formatJa(new Date(r.updatedAt))}
      </p>
    </>
  );
}
