import { requireAdmin } from "@/lib/auth";
import { appBaseUrl, repository } from "@/lib/container";
import type { Staff } from "@/lib/domain/types";
import { MIN_PASSWORD_LENGTH } from "@/lib/staff-accounts";
import { CopyButton } from "../copy-button";
import { reviewStaffAction, saveStaffAction, staffInviteAction } from "../sales-actions";

const SAVED: Record<string, string> = {
  "1": "保存しました",
  approved: "承認しました。スタッフは自分の名前とパスワードでログインできます",
  rejected: "申請を却下しました",
  invite: "登録用リンクを作りました。スタッフに送ってください（前のリンクは使えなくなりました）",
  "invite-stopped": "登録用リンクを止めました",
};

function LoginFields({ s }: { s?: Staff }) {
  return (
    <details>
      <summary>
        {!s ? "ログイン用パスワード（任意）" : `ログイン：${s.passwordHash ? "あり（自分の名前とパスワードでログイン）" : "なし"}`}
      </summary>
      <label>
        ログイン用パスワードを{s?.passwordHash ? "変更" : "設定"}（{MIN_PASSWORD_LENGTH}文字以上。空欄なら変えません）
        <input type="password" name="password" minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
      </label>
      {s?.passwordHash && (
        <label>
          <input type="checkbox" name="disableLogin" />
          ログインできないようにする
        </label>
      )}
    </details>
  );
}

function RateFields({ s }: { s?: Staff }) {
  const r = s?.backRates ?? { rate: 0, perVisit: 0 };
  return (
    <div className="grid2">
      <label>
        バック率（%・サービス料を含む売上全体に対して）
        <input name="rate" inputMode="decimal" defaultValue={r.rate} />
      </label>
      <label>
        1組ごとの固定バック（円）
        <input name="perVisit" inputMode="numeric" defaultValue={r.perVisit} />
      </label>
    </div>
  );
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await searchParams;
  const repo = repository();
  const [all, settings] = await Promise.all([repo.listStaff(), repo.getSettings()]);
  const pending = all.filter((s) => s.pending);
  const staff = all.filter((s) => !s.pending);
  const base = appBaseUrl();
  const inviteUrl = settings.staffInviteCode && base ? `${base}/join?code=${settings.staffInviteCode}` : null;
  return (
    <>
      <h1>スタッフとバック率</h1>
      <p className="muted">
        お客様の担当スタッフに、売上全体（お酒＋料金＋サービス料）× バック率 ＋ 1組ごとの固定額でバックを計算します。担当はお客様の画面か、売上の入力時に選びます。
      </p>
      {saved && <p className="notice success">{SAVED[saved] ?? SAVED["1"]}</p>}
      {error && <p className="notice error">{error}</p>}

      {pending.map((s) => (
        <form key={s.id} action={reviewStaffAction} className="card">
          <input type="hidden" name="id" value={s.id} />
          <h2 style={{ marginTop: 0 }}>登録の申請：{s.name}</h2>
          <p className="muted">承認すると、このスタッフは予約の確認と来店チェックができるようになります。バック率は承認後に下で設定してください。</p>
          <div className="row">
            <button type="submit" name="op" value="approve" className="primary">
              承認する
            </button>
            <button type="submit" name="op" value="reject">
              却下する
            </button>
          </div>
        </form>
      ))}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>スタッフに自分で登録してもらう</h2>
        <p className="muted">
          登録用リンクをLINEなどでスタッフに送ると、スタッフが自分の名前とパスワードを登録できます。あなたが承認するとログインできるようになります。
        </p>
        {settings.staffInviteCode ? (
          <>
            {inviteUrl ? (
              <p>
                <code style={{ wordBreak: "break-all" }}>{inviteUrl}</code> <CopyButton text={inviteUrl} />
              </p>
            ) : (
              <p className="notice error">APP_BASE_URL が未設定のため、リンクを表示できません。</p>
            )}
            <form action={staffInviteAction} className="row">
              <button type="submit" name="op" value="renew">
                リンクを作り直す
              </button>
              <button type="submit" name="op" value="stop">
                受付を止める
              </button>
            </form>
            <p className="muted">全員の登録が終わったら「受付を止める」をおすすめします。</p>
          </>
        ) : (
          <form action={staffInviteAction}>
            <button type="submit" name="op" value="create" className="primary">
              登録用リンクを作る
            </button>
          </form>
        )}
      </section>

      {staff.map((s) => (
        <form key={s.id} action={saveStaffAction} className="card" style={{ opacity: s.active ? 1 : 0.6 }}>
          <input type="hidden" name="id" value={s.id} />
          <label>
            名前
            <input name="name" required defaultValue={s.name} />
          </label>
          <RateFields s={s} />
          <LoginFields s={s} />
          <label>
            <input type="checkbox" name="active" defaultChecked={s.active} />
            在籍中（外すと選択肢に出なくなります。過去の売上は残ります）
          </label>
          <button type="submit">保存</button>
        </form>
      ))}

      <form action={saveStaffAction} className="card">
        <h2 style={{ marginTop: 0 }}>スタッフを追加</h2>
        <label>
          名前
          <input name="name" required />
        </label>
        <RateFields />
        <LoginFields />
        <button type="submit" className="primary">
          追加
        </button>
      </form>
    </>
  );
}
