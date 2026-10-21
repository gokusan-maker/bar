import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { appBaseUrl, repository, reservationService } from "@/lib/container";
import { availabilityPost, seatMark } from "@/lib/domain/post";
import { addDays, isValidDate, toJst } from "@/lib/domain/time";
import { CopyButton } from "../copy-button";

/** 「今夜空いてます」投稿の文面づくり */
export default async function PostPage({ searchParams }: { searchParams: Promise<{ date?: string; to?: string }> }) {
  await requireAdmin();
  const now = toJst(new Date());
  const today = now.time < "06:00" ? addDays(now.date, -1) : now.date;
  const { date: param, to } = await searchParams;
  const forX = to === "x";
  const date = param && isValidDate(param) ? param : today;
  const [settings, slots] = await Promise.all([
    repository().getSettings(),
    reservationService().availabilityBoard(date),
  ]);
  const base = appBaseUrl();
  const text = availabilityPost(settings, date, slots, {
    isToday: date === today,
    // X向けはX用リンクにして、予約をXとして集計する
    reserveUrl: settings.webBookingEnabled && base ? `${base}/reserve${forX ? "?from=x" : ""}` : null,
    lineUrl: settings.lineFriendUrl || null,
  });
  /** 日付・投稿先を保ったままのリンク */
  const q = (o: { date?: string; x?: boolean }) => {
    const p = new URLSearchParams();
    const d = o.date ?? (param ? date : undefined);
    if (d) p.set("date", d);
    if (o.x ?? forX) p.set("to", "x");
    return `/admin/post${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <h1>空き状況の投稿</h1>
      <p className="muted">
        InstagramのストーリーズやXに貼る文面です。予約の状況から自動で作ります（席数 {settings.capacity}・滞在{" "}
        {settings.stayMinutes}分で計算）。
      </p>
      <div className="row" style={{ marginBottom: 8 }} role="tablist" aria-label="投稿先">
        <Link className={`button${forX ? "" : " primary"}`} href={q({ x: false })}>
          Instagram・LINE用
        </Link>
        <Link className={`button${forX ? " primary" : ""}`} href={q({ x: true })}>
          X用
        </Link>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <Link className="button" href={q({ date: addDays(date, -1) })}>
          ← 前日
        </Link>
        {date !== today && (
          <Link className="button" href={q({ date: today })}>
            今日
          </Link>
        )}
        <Link className="button" href={q({ date: addDays(date, 1) })}>
          翌日 →
        </Link>
      </div>
      {slots.length === 0 ? (
        <p className="notice">この日は受付していません（休業日・過去の日付など）。</p>
      ) : (
        <>
          <section className="card">
            <textarea readOnly rows={text.split("\n").length + 1} value={text} style={{ maxWidth: "none" }} />
            <div style={{ marginTop: 8 }}>
              <CopyButton text={text} />
            </div>
          </section>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>時間ごとの残り</h2>
            <ul className="list">
              {slots.map((s) => (
                <li key={s.clock} className="row spread">
                  <span className="time">{s.clock}</span>
                  <span>
                    {seatMark(s.remaining, settings.capacity)} 残り {s.remaining}席
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
