import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { repository } from "@/lib/container";
import { summarizeCustomers } from "@/lib/domain/customers";
import { yen } from "@/lib/domain/sales";
import { formatJa } from "@/lib/domain/time";
import { canMessage } from "@/lib/domain/types";
import { businessDateOf } from "@/lib/reservation-service";
import { manualReplyAction, saveCustomerNoteAction } from "../../actions";
import { setCustomerStaffAction } from "../../sales-actions";
import { CHANNEL_LABEL, StatusBadge } from "../../ui";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { error, saved } = await searchParams;
  const repo = repository();
  const customer = await repo.getCustomer(id);
  if (!customer) notFound();
  const [messages, reservations, staff, sales, settings] = await Promise.all([
    repo.listMessages(id, new Date(0), 200),
    repo.listReservations({ customerId: id }),
    repo.listStaff(),
    repo.listSales({ customerId: id }),
    repo.getSettings(),
  ]);
  const [summary] = summarizeCustomers([customer], reservations, sales, (r) => businessDateOf(r, settings), new Date());
  const canReply = canMessage(customer.channel);

  return (
    <>
      <h1>
        {customer.displayName ?? customer.name ?? "名前未設定"}
        <span className="muted"> （{CHANNEL_LABEL[customer.channel]}）</span>
      </h1>
      <p className="muted">
        来店 {summary.visits}回 ・ 最終来店 {summary.lastVisit ?? "—"} ・ 利用金額 {yen(summary.totalSpend)}
        {summary.noShows > 0 && ` ・ 無断キャンセル ${summary.noShows}回`}
        {customer.externalId && <><br />ユーザーID: {customer.externalId}</>}
      </p>
      {error && <p className="notice error">{error}</p>}
      {saved && <p className="notice success">保存しました</p>}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>予約履歴（{reservations.length}件）</h2>
        <ul className="list">
          {reservations.map((r) => (
            <li key={r.id} className="row">
              <Link href={`/admin/reservations/${r.id}`}>
                {formatJa(new Date(r.startAt))} {r.partySize}名
              </Link>
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
        <form action={setCustomerStaffAction} style={{ marginTop: 12 }} className="row">
          <input type="hidden" name="customerId" value={customer.id} />
          <label style={{ marginBottom: 0, flex: 1 }}>
            担当スタッフ（バック先）
            <select name="staffId" defaultValue={customer.staffId ?? ""}>
              <option value="">なし</option>
              {staff
                .filter((s) => s.active || s.id === customer.staffId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <button type="submit" style={{ alignSelf: "flex-end" }}>
            担当を保存
          </button>
        </form>
        <form action={saveCustomerNoteAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="customerId" value={customer.id} />
          <label>
            顧客メモ（好きなお酒、NG事項など）
            <textarea name="note" rows={2} defaultValue={customer.note ?? ""} />
          </label>
          <button type="submit">メモを保存</button>
        </form>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>やり取り</h2>
        <div className="chat">
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.direction}`} title={formatJa(new Date(m.createdAt))}>
              {m.text}
            </div>
          ))}
        </div>
        {canReply && (
          <form action={manualReplyAction} style={{ marginTop: 16 }}>
            <input type="hidden" name="customerId" value={customer.id} />
            <label>
              手動で返信
              <textarea name="text" rows={3} required />
            </label>
            <button type="submit" className="primary">
              送信
            </button>
            {customer.channel === "instagram" && (
              <p className="muted">Instagramは、お客様の最後のメッセージから24時間以内のみ返信できます。</p>
            )}
          </form>
        )}
      </section>
    </>
  );
}
