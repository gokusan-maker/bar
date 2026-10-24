import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { appBaseUrl, instagramClient, lineClient, repository, reservationService } from "@/lib/container";
import { availabilityPost, seatMark } from "@/lib/domain/post";
import { addDays, isValidDate, toJst, weekdayJa } from "@/lib/domain/time";
import { CopyButton } from "../copy-button";
import { saveBirthdaySettingsAction, savePromoSettingsAction, sendPromoNowAction, uploadPromoImageAction } from "../promo-actions";
import { PromoImageInput } from "./promo-image-input";

/** LINEの今月の送信通数（取得できなければ null） */
async function lineQuota() {
  const line = lineClient();
  if (!line) return null;
  try {
    return await line.quota();
  } catch {
    return null;
  }
}

/** 「今夜空いてます」投稿の文面づくり */
export default async function PostPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; to?: string; saved?: string; sent?: string; error?: string }>;
}) {
  await requireAdmin();
  const now = toJst(new Date());
  const today = now.time < "06:00" ? addDays(now.date, -1) : now.date;
  const { date: param, to, saved, sent, error } = await searchParams;
  const forX = to === "x";
  const date = param && isValidDate(param) ? param : today;
  const [settings, slots, quota] = await Promise.all([
    repository().getSettings(),
    reservationService().availabilityBoard(date),
    lineQuota(),
  ]);
  const lineReady = !!lineClient();
  const instagramReady = !!instagramClient();
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
      <h1>集客・空き状況の投稿</h1>
      {saved && <p className="notice success">{saved === "image" ? "画像を保存しました" : "保存しました"}</p>}
      {sent && <p className="notice success">{sent}に配信しました</p>}
      {error && <p className="notice error">{error}</p>}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>自動配信（LINE・Instagram）</h2>
        <p className="muted">
          その日の空き状況を、LINEの友だち全員に自動で送ります。メッセージには空いている時間のボタンが付き、お客様がタップするとそのまま自動受付で予約まで進みます（人数・お名前もボタンと会話で聞きます）。空きがない日は送りません。
        </p>
        {!lineReady && <p className="notice">LINEが未接続です（LINE_CHANNEL_ACCESS_TOKEN）。接続すると配信できます。</p>}
        {quota && (
          <p>
            今月のLINE送信：{quota.used}通{quota.limit !== null ? ` ／ 上限 ${quota.limit}通（残り ${Math.max(0, quota.limit - quota.used)}通）` : "（上限なし・超えた分は従量課金）"}
            <br />
            <span className="muted">一斉配信は友だちの人数分の通数を使います。上限を超えそうな日は送らずにお知らせします。</span>
          </p>
        )}
        <p>最後の配信：{settings.promoLastSentDate ? settings.promoLastSentDate.replaceAll("-", "/") : "まだありません"}</p>
        <form action={savePromoSettingsAction}>
          <label>
            <input type="checkbox" name="promoEnabled" defaultChecked={settings.promoEnabled} />
            自動で配信する
          </label>
          <label>
            配信する時刻
            <select name="promoTime" defaultValue={settings.promoTime}>
              <option value="evening">17時（開店前）</option>
              <option value="noon">12時（お昼）</option>
            </select>
          </label>
          <fieldset>
            <legend>配信する曜日</legend>
            <div className="row">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <label key={d} style={{ display: "inline-flex", gap: 4 }}>
                  <input type="checkbox" name="promoWeekdays" value={d} defaultChecked={settings.promoWeekdays.includes(d)} />
                  {weekdayJa(d)}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            最初に入れるひとこと（任意。おすすめ・イベントなど）
            <textarea name="promoMessage" rows={3} maxLength={300} defaultValue={settings.promoMessage} />
          </label>
          <label>
            <input type="checkbox" name="promoInstagram" defaultChecked={settings.promoInstagram} disabled={!instagramReady} />
            Instagramのフィードにも投稿する（下の画像に、空き状況の文を添えて投稿）
            {!instagramReady && <span className="muted">（Instagram未接続）</span>}
          </label>
          <button type="submit" className="primary">
            保存
          </button>
        </form>

        {(settings.promoInstagram || instagramReady) && (
          <form action={uploadPromoImageAction} style={{ marginTop: 16 }}>
            {settings.promoImageKey && (
              // eslint-disable-next-line @next/next/no-img-element -- 店主がアップロードした画像をそのまま表示する
              <img src={`/promo-image/${settings.promoImageKey}`} alt="Instagram投稿用の画像" style={{ maxWidth: 200, borderRadius: 8 }} />
            )}
            <PromoImageInput />
            <button type="submit">{settings.promoImageKey ? "画像を変える" : "画像を保存"}</button>
          </form>
        )}

        <form action={sendPromoNowAction} style={{ marginTop: 16 }}>
          <label>
            <input type="checkbox" name="confirm" required />
            友だち全員に送る（今日の空き状況）
          </label>
          <button type="submit" disabled={!lineReady && !(settings.promoInstagram && instagramReady)}>
            今すぐ配信
          </button>
        </form>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>誕生日のお祝い（LINE）</h2>
        <p className="muted">
          お客様リストに誕生日が入っているLINEのお客様へ、誕生日の当日12時にお祝いを送ります（1人1通、送信通数にカウントされます）。誕生日はお客様の画面で入力できます。
        </p>
        <form action={saveBirthdaySettingsAction}>
          <label>
            <input type="checkbox" name="birthdayGreetingEnabled" defaultChecked={settings.birthdayGreetingEnabled} />
            誕生日にお祝いを送る
          </label>
          <label>
            お祝いの文（{"{name}"} がお名前になります）
            <textarea name="birthdayMessage" rows={4} maxLength={500} defaultValue={settings.birthdayMessage} />
          </label>
          <button type="submit">保存</button>
        </form>
      </section>

      <h2>手動で投稿する文面</h2>
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
            <div className="row" style={{ marginTop: 8 }}>
              <CopyButton text={text} />
              {forX && (
                <a className="button primary" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
                  Xで投稿する
                </a>
              )}
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
