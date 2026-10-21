import { redirect } from "next/navigation";
import { authMode, currentRole, login } from "@/lib/auth";
import { clientIp, isLockedOut, recordFailure } from "@/lib/login-guard";

async function loginAction(formData: FormData) {
  "use server";
  const ip = await clientIp();
  if (await isLockedOut(ip)) redirect("/login?error=locked");
  if (await login(String(formData.get("password") ?? ""), String(formData.get("staffName") ?? ""))) redirect("/admin");
  await recordFailure(ip);
  redirect("/login?error=1");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentRole()) redirect("/admin");
  const { error } = await searchParams;
  const mode = authMode();
  return (
    <main className="container" style={{ maxWidth: 420, paddingTop: 48 }}>
      <h1>予約管理にログイン</h1>
      {mode === "misconfigured" && (
        <p className="notice error">
          ADMIN_PASSWORD と SESSION_SECRET が設定されていないため、ログインできません。
        </p>
      )}
      {error === "locked" && (
        <p className="notice error">ログインの失敗が続いたため、しばらく（15分ほど）ログインできません。</p>
      )}
      {error === "1" && <p className="notice error">名前かパスワードが違います（スタッフの方は、店主の承認が済んでいるかもご確認ください）</p>}
      <form action={loginAction} className="card">
        <label>
          お名前（スタッフの方）
          <input name="staffName" autoComplete="username" maxLength={30} />
          <span className="muted">店主の方は空欄のままにしてください</span>
        </label>
        <label>
          パスワード
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
        <button className="primary" type="submit">
          ログイン
        </button>
      </form>
    </main>
  );
}
