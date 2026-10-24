import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { lineLoginConfig, notifier, repository } from "@/lib/container";
import { LineLoginButton } from "../login/line-button";
import { clientIp, isLockedOut, recordFailure } from "@/lib/login-guard";
import { isValidInviteCode, MIN_PASSWORD_LENGTH, registerStaff } from "@/lib/staff-accounts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "スタッフ登録",
  robots: { index: false },
};

async function joinAction(formData: FormData) {
  "use server";
  const field = (k: string) => String(formData.get(k) ?? "");
  const code = field("code");
  const back = (params: Record<string, string>) => redirect(`/join?${new URLSearchParams({ code, ...params })}`);
  const ip = await clientIp();
  if (await isLockedOut(ip)) back({ error: "しばらく時間をおいてからお試しください" });
  if (field("password") !== field("password2"))
    back({ error: "確認用のパスワードが一致しません", name: field("name"), loginId: field("loginId") });

  const repo = repository();
  const result = await registerStaff(repo, {
    code,
    name: field("name"),
    password: field("password"),
    loginId: field("loginId"),
  });
  if (!result.ok) {
    // 合言葉の総当たりを防ぐため、ログイン失敗と同じく数える
    if (!(await isValidInviteCode(repo, code))) await recordFailure(ip);
    back({ error: result.error, name: field("name"), loginId: field("loginId") });
  } else {
    await recordAudit({
      actor: "staff",
      action: "スタッフ登録を申請",
      targetType: "staff",
      targetId: result.staff.id,
      detail: result.staff.name,
    });
    await notifier().notify(
      `スタッフ登録の申請がありました: ${result.staff.name}\n管理画面の「スタッフ」で承認してください`,
    );
    back({ done: "1" });
  }
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{
    code?: string;
    error?: string;
    done?: string;
    name?: string;
    loginId?: string;
  }>;
}) {
  const { code = "", error, done, name, loginId } = await searchParams;
  const settings = await repository().getSettings();
  const valid = await isValidInviteCode(repository(), code);
  return (
    <main className="container" style={{ maxWidth: 420, paddingTop: 48 }}>
      <h1>{settings.shopName} スタッフ登録</h1>
      {done ? (
        <div className="card">
          <p className="notice success">申請しました。店主が承認すると、ログインできるようになります。</p>
          <p>
            承認後は <Link href="/login">スタッフのログイン画面</Link>{" "}
            から、「LINEでログイン」（または登録したお名前とパスワード）でログインしてください。
          </p>
        </div>
      ) : !valid ? (
        <p className="notice error">このリンクは使えません。店主に新しい登録用リンクをもらってください。</p>
      ) : (
        <>
          {lineLoginConfig() && (
            <section className="card">
              {error && <p className="notice error">{error}</p>}
              <LineLoginButton purpose="join" code={code} label="LINEで登録（おすすめ）" />
              <p className="muted" style={{ marginBottom: 0 }}>
                LINEの名前で申請します。承認後は「LINEでログイン」だけでログインできます。
              </p>
            </section>
          )}
          <details className="card" open={!lineLoginConfig()}>
            <summary>名前とパスワードで登録</summary>
            <form action={joinAction}>
              {error && <p className="notice error">{error}</p>}
              <input type="hidden" name="code" value={code} />
              <label>
                お名前（ログインのときに使います）
                <input name="name" required maxLength={30} defaultValue={name} />
              </label>
              <label>
                ログインID（半角英数字3〜30文字。例: yuka）
                <input
                  name="loginId"
                  required
                  minLength={3}
                  maxLength={30}
                  pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{2,29}"
                  defaultValue={loginId}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
              <label>
                パスワード（{MIN_PASSWORD_LENGTH}文字以上）
                <input
                  type="password"
                  name="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                />
              </label>
              <label>
                パスワード（確認）
                <input
                  type="password"
                  name="password2"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                />
              </label>
              <p className="muted">
                登録後、店主が承認するとログインできます。ログインすると、予約の確認と来店チェックができます。
              </p>
              <button className="primary" type="submit">
                登録を申請する
              </button>
            </form>
          </details>
        </>
      )}
    </main>
  );
}
