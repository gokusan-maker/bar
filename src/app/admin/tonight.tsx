import Link from "next/link";
import type { SlotAvailability } from "@/lib/domain/availability";
import { weekdayJa, weekdayOf } from "@/lib/domain/time";
import type { Reservation, ShopSettings } from "@/lib/domain/types";

/** 予約一覧の先頭に出す「今夜」のまとめ */
export function Tonight({
  date,
  settings,
  reservations,
  board,
  pendingCount,
  owner,
}: {
  date: string;
  settings: ShopSettings;
  reservations: Reservation[];
  board: SlotAvailability[];
  pendingCount: number;
  owner: boolean;
}) {
  const active = reservations.filter((r) => r.status === "pending" || r.status === "confirmed");
  const arrived = reservations.filter((r) => r.status === "visited");
  const guests = active.reduce((n, r) => n + r.partySize, 0) + arrived.reduce((n, r) => n + r.partySize, 0);
  const [, m, d] = date.split("-").map(Number);
  const closed = settings.closedWeekdays.includes(weekdayOf(date)) || settings.closedDates.includes(date);

  return (
    <section className="card tonight">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>
          今夜 {m}/{d}({weekdayJa(weekdayOf(date))})
        </h2>
        {owner && (
          <div className="row">
            <Link className="button small-button" href="/admin/new">
              ＋ 電話予約
            </Link>
            <Link className="button small-button" href="/admin/post">
              空き投稿
            </Link>
          </div>
        )}
      </div>
      {closed ? (
        <p className="muted">本日は休業日です</p>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <span className="muted">予約</span>
              <strong>{active.length + arrived.length}組</strong>
            </div>
            <div className="tile">
              <span className="muted">来店予定</span>
              <strong>{guests}名</strong>
            </div>
            <div className="tile">
              <span className="muted">来店済</span>
              <strong>{arrived.length}組</strong>
            </div>
            <Link className={`tile ${pendingCount ? "tile-alert" : ""}`} href="/admin#pending">
              <span className="muted">承認待ち</span>
              <strong>{pendingCount}件</strong>
            </Link>
          </div>
          {board.length > 0 && (
            <div className="occupancy" aria-label="時間ごとの席の埋まり具合">
              {board.map((s) => {
                const used = settings.capacity - s.remaining;
                const pct = Math.min(100, Math.round((used / settings.capacity) * 100));
                const h = Number(s.clock.slice(0, 2));
                return (
                  <div key={s.clock} className="occ-col" title={`${s.clock} ${used}/${settings.capacity}席`}>
                    <div className="occ-track">
                      <div className={`occ-fill ${pct >= 100 ? "full" : pct >= 70 ? "busy" : ""}`} style={{ height: `${pct}%` }} />
                    </div>
                    <span className="occ-label">{h >= 24 ? h - 24 : h}時</span>
                    <span className="occ-num">{s.remaining > 0 ? `残${s.remaining}` : "満"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
