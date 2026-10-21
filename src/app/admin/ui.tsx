import { CHANNEL_LABEL, STATUS_LABEL, type Reservation, type ReservationStatus } from "@/lib/domain/types";
import { reservationAction } from "./actions";

export { STATUS_LABEL };

export { CHANNEL_LABEL };

export function StatusBadge({ status }: { status: ReservationStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

function OpButton({
  id,
  op,
  label,
  returnTo,
  className,
}: {
  id: string;
  op: string;
  label: string;
  returnTo?: string;
  className?: string;
}) {
  return (
    <form action={reservationAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      {returnTo && <input type="hidden" name="return" value={returnTo} />}
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}

/** 予約の状態に応じた操作ボタン */
export function ReservationActions({ r, returnTo }: { r: Reservation; returnTo?: string }) {
  if (r.status === "pending") {
    return (
      <div className="row">
        <OpButton id={r.id} op="approve" label="承認する" className="primary" returnTo={returnTo} />
        <OpButton id={r.id} op="reject" label="お断りする" className="danger" returnTo={returnTo} />
      </div>
    );
  }
  if (r.status === "confirmed") {
    return (
      <div className="row">
        <OpButton id={r.id} op="visited" label="来店" returnTo={returnTo} />
        <OpButton id={r.id} op="no_show" label="無断キャンセル" returnTo={returnTo} />
      </div>
    );
  }
  return null;
}
