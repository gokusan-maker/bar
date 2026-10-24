import Link from "next/link";
import { redirect } from "next/navigation";
import { authMode, currentRole, loginStaff } from "@/lib/auth";
import { lineLoginConfig } from "@/lib/container";
import { clientIp, isLockedOut, recordFailure } from "@/lib/login-guard";
import { LINE_LOGIN_ERRORS_STAFF } from "./messages";
import { LineLoginButton, LOGIN_ERRORS } from "./line-button";

async function loginAction(formData: FormData) {
  "use server";
  const ip = await clientIp();
  if (await isLockedOut(ip)) redirect("/login?error=locked");
  if (await loginStaff(String(formData.get("password") ?? ""), String(formData.get("staffName") ?? ""))) redirect("/admin");
  await recordFailure(ip);
  redirect("/login?error=1");
}

/** スタッフのログイン */
export default async function StaffLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentRole()) redirect("/admin");
  const { error } = await searchParams;
  const mode = authMode();
  return (
    <main className="container" style={{ maxWidth: 420, paddingTop: 48 }}>
      <h1>スタッフログイン</h1>
      {mode === "misconfigured" && <p className="notice error">SESSION_SECRET などが設定されていないため、ログインできません。</p>}
      {error && <p className="notice error">{LINE_LOGIN_ERRORS_STAFF[error] ?? LOGIN_ERRORS[error] ?? LOGIN_ERRORS["1"]}</p>}
      {lineLoginConfig() && (
        <section className="card">
          <LineLoginButton purpose="staff" />
          <p className="muted" style={{ marginBottom: 0 }}>
            はじめての方は、店主から届いた登録用リンクから「LINEで登録」してください。
          </p>
        </section>
      )}
      <details className="card" open={!lineLoginConfig()}>
        <summary>名前とパスワードでログイン</summary>
        <form action={loginAction}>
          <label>
            お名前
            <input name="staffName" autoComplete="username" maxLength={30} />
            <span className="muted">共通のスタッフ用パスワードの場合は空欄</span>
          </label>
          <label>
            パスワード
            <input type="password" name="password" required autoComplete="current-password" />
          </label>
          <button className="primary" type="submit">
            ログイン
          </button>
        </form>
      </details>
      <p>
        <Link href="/owner/login">オーナーの方はこちら</Link>
      </p>
    </main>
  );
}
