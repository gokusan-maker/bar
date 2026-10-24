import Link from "next/link";
import { redirect } from "next/navigation";
import { authMode, currentRole, loginOwner } from "@/lib/auth";
import { lineLoginConfig } from "@/lib/container";
import { clientIp, isLockedOut, recordFailure } from "@/lib/login-guard";
import { LineLoginButton, LOGIN_ERRORS } from "../../login/line-button";

async function ownerLoginAction(formData: FormData) {
  "use server";
  const ip = await clientIp();
  if (await isLockedOut(ip)) redirect("/owner/login?error=locked");
  if (await loginOwner(String(formData.get("password") ?? ""))) redirect("/admin");
  await recordFailure(ip);
  redirect("/owner/login?error=password");
}

const OWNER_ERRORS: Record<string, string> = {
  password: "パスワードが違います",
  line_unlinked: "このLINEはオーナーとして連携されていません。パスワードでログインし、「設定」→「LINEでログインできるようにする」から連携してください。",
};

/** オーナー（店主）のログイン */
export default async function OwnerLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const role = await currentRole();
  if (role === "owner") redirect("/admin");
  const { error } = await searchParams;
  const mode = authMode();
  return (
    <main className="container" style={{ maxWidth: 420, paddingTop: 48 }}>
      <h1>オーナー管理画面</h1>
      {role === "staff" && <p className="notice">スタッフとしてログイン中です。オーナーとしてログインすると切り替わります。</p>}
      {mode === "misconfigured" && <p className="notice error">ADMIN_PASSWORD と SESSION_SECRET が設定されていないため、ログインできません。</p>}
      {error && <p className="notice error">{OWNER_ERRORS[error] ?? LOGIN_ERRORS[error] ?? OWNER_ERRORS.password}</p>}
      {lineLoginConfig() && (
        <section className="card">
          <LineLoginButton purpose="owner" />
        </section>
      )}
      <form action={ownerLoginAction} className="card">
        <label>
          オーナー用パスワード
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
        <button className="primary" type="submit">
          ログイン
        </button>
      </form>
      <p>
        <Link href="/login">スタッフの方はこちら</Link>
      </p>
    </main>
  );
}
