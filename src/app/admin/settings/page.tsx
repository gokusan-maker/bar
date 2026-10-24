import { requireAdmin } from "@/lib/auth";
import { appBaseUrl, googleOAuthConfig, lineLoginConfig, repository } from "@/lib/container";
import { LineLoginButton } from "../../login/line-button";
import { weekdayJa } from "@/lib/domain/time";
import { THEMES } from "@/lib/domain/theme";
import { listCalendars } from "@/lib/integrations/google-calendar";
import {
  disconnectGoogleAction,
  pullCalendarAction,
  saveCalendarAction,
  saveOwnerLoginIdAction,
  saveSettingsAction,
  unlinkOwnerLineAction,
} from "../actions";

const SHOP_TYPES = ["バー", "ダーツバー", "スナック", "ガールズバー", "コンセプトカフェ", "ラウンジ", "居酒屋", "カラオケバー"];
const EMPTY_AREAS = Array.from({ length: 3 }, () => ({ name: "", seats: 0 }));

const GOOGLE_MESSAGES: Record<string, { text: string; className: string }> = {
  connected: { text: "Googleカレンダーと連携しました", className: "success" },
  disconnected: { text: "Googleカレンダーの連携を解除しました", className: "success" },
  error: { text: "Googleカレンダーの連携に失敗しました。もう一度お試しください。", className: "error" },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; google?: string; error?: string; pulled?: string; line?: string }>;
}) {
  await requireAdmin();
  const { saved, google, error, pulled, line } = await searchParams;
  const [moved, deleted, failed] = (pulled ?? "").split("-").map(Number);
  const repo = repository();
  const [s, integration] = await Promise.all([repo.getSettings(), repo.getGoogleIntegration()]);
  const oauth = googleOAuthConfig();

  let calendars: { id: string; summary: string; primary: boolean }[] = [];
  let calendarError = false;
  if (oauth && integration) {
    try {
      calendars = await listCalendars(oauth, integration);
    } catch (error) {
      console.error("listCalendars failed", error);
      calendarError = true;
    }
  }
  const base = appBaseUrl() ?? "https://<あなたのドメイン>";

  return (
    <>
      <div className="row spread">
        <h1 style={{ margin: 0 }}>設定</h1>
        <a className="button" href="/admin/diagnostics">
          セットアップ診断
        </a>
      </div>
      {saved && <p className="notice success">保存しました</p>}
      {error && <p className="notice error">{error}</p>}
      {line === "linked" && <p className="notice success">LINEを連携しました。次からはオーナーのログイン画面で「LINEでログイン」できます。</p>}
      {line === "unlinked" && <p className="notice success">LINEの連携を外しました。</p>}
      {line === "staff_conflict" && <p className="notice error">このLINEはスタッフとして登録されています。オーナー用には別のLINEアカウントを使ってください。</p>}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>オーナーのログイン</h2>
        <form action={saveOwnerLoginIdAction} className="row" style={{ alignItems: "flex-end" }}>
          <label style={{ flex: 1, marginBottom: 0 }}>
            ログインID（パスワードは環境変数 ADMIN_PASSWORD）
            <input name="ownerLoginId" required defaultValue={s.ownerLoginId || "admin"} autoCapitalize="none" spellCheck={false} maxLength={30} />
          </label>
          <button type="submit">IDを保存</button>
        </form>
        <p className="muted">
          連携すると、オーナーのログイン画面（{base}/owner/login）で「LINEでログイン」できます。スタッフは {base}/login からログインします。
        </p>
        <p>連携しているLINE：{s.ownerLineUserIds.length}件</p>
        {lineLoginConfig() ? (
          <div className="row">
            <LineLoginButton purpose="link-owner" label="LINEでログインできるようにする" />
            {s.ownerLineUserIds.length > 0 && (
              <form action={unlinkOwnerLineAction}>
                <button type="submit">LINEの連携をすべて外す</button>
              </form>
            )}
          </div>
        ) : (
          <p className="notice">LINEログインのチャネルが未設定です（LINE_LOGIN_CHANNEL_ID・LINE_LOGIN_CHANNEL_SECRET）。</p>
        )}
      </section>
      {pulled && (
        <p className={`notice ${failed ? "error" : "success"}`}>
          カレンダーから取り込みました: 時間変更 {moved}件・削除 {deleted}件{failed ? `・取得できなかった予定 ${failed}件` : ""}
        </p>
      )}
      {google && GOOGLE_MESSAGES[google] && (
        <p className={`notice ${GOOGLE_MESSAGES[google].className}`}>{GOOGLE_MESSAGES[google].text}</p>
      )}

      <form action={saveSettingsAction}>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>お店</h2>
          <div className="grid2">
            <label>
              店名
              <input name="shopName" defaultValue={s.shopName} />
            </label>
            <label>
              店の種類
              <input name="shopType" list="shop-types" defaultValue={s.shopType} />
              <datalist id="shop-types">
                {SHOP_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            <label>
              開店時刻
              <input name="openTime" defaultValue={s.openTime} placeholder="19:00" />
            </label>
            <label>
              閉店時刻（深夜2時は 26:00）
              <input name="closeTime" defaultValue={s.closeTime} placeholder="26:00" />
            </label>
            <label>
              最終入店（閉店の何分前まで）
              <input type="number" name="lastEntryMinutesBeforeClose" min={0} defaultValue={s.lastEntryMinutesBeforeClose} />
            </label>
          </div>
          <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px" }}>
            <legend style={{ fontSize: "0.95rem" }}>定休日</legend>
            <div className="row">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <label key={d} style={{ marginBottom: 0 }}>
                  <input type="checkbox" name="closedWeekdays" value={d} defaultChecked={s.closedWeekdays.includes(d)} />
                  {weekdayJa(d)}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            臨時休業日（YYYY-MM-DD をカンマ区切り）
            <input name="closedDates" defaultValue={s.closedDates.join(", ")} placeholder="2026-12-31, 2027-01-01" />
          </label>
          <label>
            お店の電話番号（予約フォームと、直前のご予約などの返信に表示）
            <input name="shopPhone" type="tel" defaultValue={s.shopPhone} placeholder="03-1234-5678" />
          </label>
          <label>
            LINE公式アカウントの友だち追加URL（予約フォームや空き状況の投稿でLINEへ案内）
            <input name="lineFriendUrl" type="url" defaultValue={s.lineFriendUrl} placeholder="https://lin.ee/xxxxxxx" />
          </label>
          <label>
            予約フォームに表示するひとこと
            <textarea
              name="shopMessage"
              rows={2}
              maxLength={300}
              defaultValue={s.shopMessage}
              placeholder="ダーツ2台・カウンター8席。お一人さまも歓迎です！"
            />
          </label>
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontSize: "0.95rem", marginBottom: 6 }}>テーマカラー（管理画面と予約フォームの色）</legend>
            <div className="row">
              {Object.entries(THEMES).map(([key, t]) => (
                <label key={key} className="swatch">
                  <input type="radio" name="themeColor" value={key} defaultChecked={s.themeColor === key} />
                  <span className="dot" style={{ background: t.light }} aria-hidden="true" />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>席</h2>
          <p className="muted">
            カウンター・テーブル・個室・ダーツ台まわりなど、自由に名前を付けて登録できます。合計 {s.capacity}席
            が同時に受け入れられる人数になります。不要な行は空欄にしてください。
          </p>
          {[...s.seatAreas, ...EMPTY_AREAS].map((a, i) => (
            <div key={i} className="row">
              <input name="areaName" placeholder="例: 個室" defaultValue={a.name} style={{ flex: 2, minWidth: 0 }} aria-label="席の名前" />
              <input
                name="areaSeats"
                type="number"
                min={1}
                placeholder="席数"
                defaultValue={a.seats || ""}
                style={{ flex: 1, minWidth: 0 }}
                aria-label="席数"
              />
            </div>
          ))}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>受付ルール</h2>
          <div className="grid2">
            <label>
              1組の上限人数（超えたら貸切相談）
              <input type="number" name="maxPartySize" min={1} defaultValue={s.maxPartySize} />
            </label>
            <label>
              標準の滞在時間（分）
              <input type="number" name="stayMinutes" min={15} step={15} defaultValue={s.stayMinutes} />
            </label>
            <label>
              何分前まで予約を受け付けるか
              <input type="number" name="minLeadMinutes" min={0} defaultValue={s.minLeadMinutes} />
            </label>
            <label>
              何日先まで受け付けるか
              <input type="number" name="maxAdvanceDays" min={1} defaultValue={s.maxAdvanceDays} />
            </label>
            <label>
              自動確定する最大人数
              <input type="number" name="autoConfirmMaxParty" min={1} defaultValue={s.autoConfirmMaxParty} />
            </label>
          </div>
          <label>
            <input type="checkbox" name="autoConfirm" defaultChecked={s.autoConfirm} />
            空いていれば自動で確定する（オフにすると全件、店主の承認待ちになります）
          </label>
          <label>
            <input type="checkbox" name="sendReminders" defaultChecked={s.sendReminders} />
            前日にリマインドを送る（LINE・Instagram）
          </label>
          <label>
            <input type="checkbox" name="blockOnCalendarEvents" defaultChecked={s.blockOnCalendarEvents} />
            Googleカレンダーに予約以外の予定（休業・貸切など）がある時間は受け付けない
          </label>
          <label>
            <input type="checkbox" name="webBookingEnabled" defaultChecked={s.webBookingEnabled} />
            予約フォーム（/reserve）での受付をオンにする
          </label>
          <label>
            <input type="checkbox" name="manualMode" defaultChecked={s.manualMode} />
            手動モード（自動返信を止め、メッセージを店主に通知するだけにする）
          </label>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>売上・バック</h2>
          <div className="grid2">
            <label>
              1人あたりのチャージ（円）
              <input type="number" name="chargePerPerson" min={0} defaultValue={s.chargePerPerson} />
            </label>
            <label>
              サービス料率（%）
              <input name="serviceChargeRate" inputMode="decimal" defaultValue={s.serviceChargeRate} />
            </label>
          </div>
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontSize: "0.95rem" }}>バックの対象</legend>
            <label>
              <input type="radio" name="backTarget" value="sns" defaultChecked={s.backTarget === "sns"} />
              SNS（LINE・Instagram）経由の売上だけ
            </label>
            <label>
              <input type="radio" name="backTarget" value="all" defaultChecked={s.backTarget === "all"} />
              すべての売上（電話・来店・紹介も含む）
            </label>
          </fieldset>
        </section>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>個人情報の保存期間</h2>
          <label>
            保存する期間（月）。0にすると自動削除しません
            <input type="number" name="retentionMonths" min={0} defaultValue={s.retentionMonths} />
          </label>
          <p className="muted" style={{ margin: 0 }}>
            期間を過ぎたメッセージは削除し、予約・売上・お客様の名前やSNSのIDは消します。
            売上の金額と証拠写真は帳簿書類として残ります（税法上7年間の保存が必要です）。
          </p>
        </section>
        <button type="submit" className="primary">
          設定を保存
        </button>
      </form>

      <section className="card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>Googleカレンダー</h2>
        {!oauth ? (
          <p className="muted">
            GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET・APP_BASE_URL を設定すると連携できます。
          </p>
        ) : integration ? (
          <>
            <p>連携中: {integration.accountEmail ?? "Googleアカウント"}</p>
            {calendarError && <p className="notice error">カレンダー一覧を取得できませんでした。再連携してください。</p>}
            {calendars.length > 0 && (
              <form action={saveCalendarAction}>
                <label>
                  予約を書き込むカレンダー
                  <select name="calendarId" defaultValue={integration.calendarId}>
                    {calendars.map((c) => (
                      <option key={c.id} value={c.primary ? "primary" : c.id}>
                        {c.summary}
                        {c.primary ? "（メイン）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">カレンダーを保存</button>
              </form>
            )}
            <p className="muted">
              カレンダー上で予約の予定を移動・削除した場合は、毎日17時に自動で予約へ反映されます。すぐ反映したいときは下のボタンを押してください。
            </p>
            <form action={pullCalendarAction}>
              <button type="submit">カレンダーの変更を今すぐ取り込む</button>
            </form>
            <div className="row" style={{ marginTop: 12 }}>
              <a className="button" href="/api/google/connect">
                再連携
              </a>
              <form action={disconnectGoogleAction} className="inline">
                <button type="submit" className="danger">
                  連携を解除
                </button>
              </form>
            </div>
          </>
        ) : (
          <a className="button primary" href="/api/google/connect">
            Googleカレンダーと連携する
          </a>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>データの書き出し（CSV）</h2>
        <p className="muted">バックアップや、Excelでの集計に使えます。</p>
        <div className="row">
          <a className="button" href="/api/export?kind=reservations">
            予約
          </a>
          <a className="button" href="/api/export?kind=sales">
            売上
          </a>
          <a className="button" href="/api/export?kind=customers">
            お客様
          </a>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>SNSに載せるリンク</h2>
        <p className="muted">予約フォームは{s.webBookingEnabled ? "受付中" : "停止中（上の設定でオンにしてください）"}です。</p>
        <dl className="links">
          <dt>LINE（メイン）</dt>
          <dd>
            トークでそのまま予約を自動受付。リッチメニューには <code>{base}/reserve</code>
            {s.lineFriendUrl ? (
              <>
                <br />友だち追加: <code>{s.lineFriendUrl}</code>
              </>
            ) : (
              <>
                <br />
                <span className="muted">友だち追加URLを設定すると、フォームや投稿からLINEへ案内できます</span>
              </>
            )}
          </dd>
          <dt>Instagram</dt>
          <dd>
            DMを自動受付（連携した場合）。プロフィールのリンクには <code>{base}/reserve</code>
          </dd>
          <dt>X（Twitter）</dt>
          <dd>
            プロフィールと投稿に <code>{base}/reserve?from=x</code>
            <br />
            <span className="muted">
              XのDMの自動受付は、XのAPIが有料（従量課金）のため使っていません。このリンクからの予約は「X」として集計されます。
            </span>
          </dd>
        </dl>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>SNSの接続先（Webhook URL）</h2>
        <p className="muted">各サービスの管理画面に、以下のURLを登録してください。</p>
        <ul>
          <li>
            LINE: <code>{base}/api/webhooks/line</code>
            {process.env.LINE_CHANNEL_SECRET ? " ✓" : "（未設定）"}
          </li>
          <li>
            Instagram: <code>{base}/api/webhooks/instagram</code>
            {process.env.INSTAGRAM_APP_SECRET ? " ✓" : "（未設定）"}
          </li>
        </ul>
      </section>
    </>
  );
}
