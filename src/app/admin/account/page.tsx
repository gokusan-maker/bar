import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { lineLoginConfig, repository } from "@/lib/container";
import { MIN_PASSWORD_LENGTH } from "@/lib/staff-accounts";
import { LineLoginButton } from "../../login/line-button";
import { changeOwnPasswordAction } from "./actions";

/** スタッフ本人のアカウント（LINEの連携・パスワード） */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ linked?: string; saved?: string; error?: string }> }) {
  const session = await currentSession();
  if (session?.role === "owner") redirect("/admin/settings");
  if (!session) redirect("/login");
  const { linked, saved, error } = await searchParams;
  const me = session.staffId ? await repository().getStaff(session.staffId) : null;

  return (
    <>
      <h1>アカウント</h1>
      {linked && <p className="notice success">LINEを連携しました。次からは「LINEでログイン」でログインできます。</p>}
      {saved && <p className="notice success">パスワードを保存しました</p>}
      {error && <p className="notice error">{error}</p>}
      {!me ? (
        <p className="notice">共通のスタッフ用パスワードでログインしています。自分のアカウントを作るには、店主から登録用リンクをもらってください。</p>
      ) : (
        <>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>{me.name}</h2>
            <p>LINEでログイン：{me.lineUserId ? "連携済み" : "未連携"}</p>
            {!me.lineUserId &&
              (lineLoginConfig() ? (
                <LineLoginButton purpose="link-staff" label="LINEと連携する" />
              ) : (
                <p className="muted">LINEログインが設定されていません（店主にお問い合わせください）。</p>
              ))}
          </section>
          <form action={changeOwnPasswordAction} className="card">
            <h2 style={{ marginTop: 0 }}>{me.passwordHash ? "パスワードを変える" : "パスワードを決める（LINEが使えないとき用）"}</h2>
            {me.passwordHash && (
              <label>
                今のパスワード
                <input type="password" name="currentPassword" required autoComplete="current-password" />
              </label>
            )}
            <label>
              新しいパスワード（{MIN_PASSWORD_LENGTH}文字以上）
              <input type="password" name="newPassword" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
            </label>
            <label>
              新しいパスワード（確認）
              <input type="password" name="newPassword2" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
            </label>
            <button type="submit">保存</button>
          </form>
        </>
      )}
    </>
  );
}
