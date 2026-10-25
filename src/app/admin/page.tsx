import Link from "next/link";
import { currentRole } from "@/lib/auth";
import { repository, reservationService } from "@/lib/container";
import { Tonight } from "./tonight";
import { addDays, DAY_MS, formatJa, fromJst, isValidDate, toJst, weekdayOf, weekdayJa } from "@/lib/domain/time";
import type { Reservation } from "@/lib/domain/types";
import { businessDayStart } from "@/lib/order-service";
import { businessClockOf, businessDateOf } from "@/lib/reservation-service";
import { CHANNEL_LABEL, ReservationActions, StatusBadge } from "./ui";

const DAYS = 7;

/** 朝6時までは前日の営業日として扱う */
function currentBusinessDate(now: Date): string {
  const p = toJst(now);
  return p.time < "06:00" ? addDays(p.date, -1) : p.date;
}

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; done?: string; forbidden?: string }>;
}) {
  const params = await searchParams;
  const owner = (await currentRole()) === "owner";
  const now = new Date();
  const today = currentBusinessDate(now);
  const from = params.from && isValidDate(params.from) ? params.from : today;
  const repo = repository();
  const settings = await repo.getSettings();

  const [pending, inRange, board, orders] = await Promise.all([
    repo.listReservations({ from: now, statuses: ["pending"] }),
    repo.listReservations({
      from: fromJst(from, "06:00"),
      to: new Date(fromJst(from, "06:00").getTime() + DAYS * DAY_MS),
    }),
    reservationService().availabilityBoard(today),
    repo.listOrders({ since: businessDayStart(now), limit: 500 }),
  ]);
  const liveOrders = orders.filter((o) => o.status !== "cancelled");

  const byDate = new Map<string, Reservation[]>();
  for (let i = 0; i < DAYS; i++) byDate.set(addDays(from, i), []);
  for (const r of inRange) byDate.get(businessDateOf(r, settings))?.push(r);

  return (
    <>
      {params.done && <p className="notice success">更新しました</p>}
      {params.forbidden && <p className="notice error">この画面は店主のみ利用できます</p>}
      {from === today && (
        <Tonight
          date={today}
          settings={settings}
          reservations={byDate.get(today) ?? []}
          board={board}
          pendingCount={pending.length}
          owner={owner}
          orders={{
            waiting: liveOrders.filter((o) => o.status === "new").length,
            total: liveOrders.reduce((n, o) => n + o.total, 0),
          }}
        />
      )}

      {pending.length > 0 && (
        <section className="card" id="pending">
          <h2 style={{ marginTop: 0 }}>承認待ち（{pending.length}件）</h2>
          <ul className="list">
            {pending.map((r) => (
              <li key={r.id}>
                <div className="row spread">
                  <Link href={`/admin/reservations/${r.id}`}>
                    {formatJa(new Date(r.startAt))} {r.name}様 {r.partySize}名
                  </Link>
                  <span className="muted">{CHANNEL_LABEL[r.channel]}</span>
                </div>
                {r.notes && <div className="muted">要望: {r.notes}</div>}
                {owner && (
                  <div style={{ marginTop: 6 }}>
                    <ReservationActions r={r} returnTo="/admin" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="row spread" style={{ margin: "8px 0" }}>
        <h1 style={{ margin: 0 }}>予約一覧</h1>
        <div className="row">
          <Link className="button" href={`/admin?from=${addDays(from, -DAYS)}`}>
            ← 前の週
          </Link>
          {from !== today && (
            <Link className="button" href="/admin">
              今日
            </Link>
          )}
          <Link className="button" href={`/admin?from=${addDays(from, DAYS)}`}>
            次の週 →
          </Link>
        </div>
      </div>

      {[...byDate.entries()].map(([date, list]) => {
        const active = list.filter((r) => r.status === "pending" || r.status === "confirmed");
        const closed =
          settings.closedWeekdays.includes(weekdayOf(date)) || settings.closedDates.includes(date);
        const [, m, d] = date.split("-").map(Number);
        return (
          <section key={date} className="card">
            <div className="row spread">
              <strong>
                {m}/{d}({weekdayJa(weekdayOf(date))}){date === today && " 今日"}
              </strong>
              <span className="muted">
                {closed ? "休業日" : `${active.length}組 ${active.reduce((n, r) => n + r.partySize, 0)}名`}
              </span>
            </div>
            {list.length === 0 ? (
              <p className="muted" style={{ margin: "4px 0 0" }}>
                予約なし
              </p>
            ) : (
              <ul className="list">
                {list.map((r) => (
                  <li key={r.id} style={{ opacity: active.includes(r) ? 1 : 0.55 }}>
                    <div className="row">
                      <span className="time">{businessClockOf(r, settings)}</span>
                      <Link href={`/admin/reservations/${r.id}`}>
                        {r.name}様 {r.partySize}名
                      </Link>
                      <StatusBadge status={r.status} />
                      <span className="muted">{CHANNEL_LABEL[r.channel]}</span>
                    </div>
                    {r.notes && <div className="muted">要望: {r.notes}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
