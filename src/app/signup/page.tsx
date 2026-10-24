import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { reservedLoginIds, startMemberSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { directory, shopRepository, stripeConfig, trialDays } from "@/lib/container";
import { DEFAULT_SHOP_ID } from "@/lib/domain/types";
import { clientIp, isLockedOut, recordFailure } from "@/lib/login-guard";
import { withShop } from "@/lib/shop-context";
import { signupShop } from "@/lib/signup";
import { MIN_PASSWORD_LENGTH } from "@/lib/staff-accounts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "お店の登録", robots: { index: false } };

/** 1つのIPから1時間に登録できる店舗の数（いたずら対策） */
const MAX_SIGNUPS_PER_HOUR = 3;

async function signupAction(formData: FormData) {
  "use server";
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  const keep = { shopName: field("shopName"), slug: field("slug"), ownerName: field("ownerName"), loginId: field("loginId") };
  const back = (error: string): never => redirect(`/signup?${new URLSearchParams({ error, ...keep })}`);
  const ip = await clientIp();
  if (await isLockedOut(ip)) back("しばらく時間をおいてからお試しください");
  // 登録コード（SIGNUP_CODE）を決めている場合は、知っている人だけが登録できる
  const code = process.env.SIGNUP_CODE?.trim();
  if (code && field("signupCode") !== code) {
    await recordFailure(ip);
    back("登録コードが違います");
  }
  if (String(formData.get("password")) !== String(formData.get("password2"))) back("確認用のパスワードが一致しません");
  const log = shopRepository(DEFAULT_SHOP_ID);
  if ((await log.countWebRequests(new Date(Date.now() - 3600_000), `signup:${ip}`)) >= MAX_SIGNUPS_PER_HOUR) {
    back("登録が続いています。しばらくしてからお試しください");
  }
  await log.recordWebRequest(`signup:${ip}`);

  const result = await signupShop(
    directory(),
    shopRepository,
    { ...keep, password: String(formData.get("password") ?? "") },
    await reservedLoginIds(),
    stripeConfig() ? new Date(Date.now() + trialDays() * 86400_000).toISOString() : null,
  );
  if (!result.ok) back(result.error);
  else {
    await withShop(result.shop.id, () =>
      recordAudit({ actor: "owner", action: "お店を登録", targetType: "settings", targetId: null, detail: result.shop.name }),
    );
    await startMemberSession(result.shop.id, result.owner);
    redirect("/admin/settings?welcome=1");
  }
}

/** オーナーがお店を登録する（お店ごとにオーナー・スタッフ・お客様・売上を分けて使える） */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; shopName?: string; slug?: string; ownerName?: string; loginId?: string }>;
}) {
  const p = await searchParams;
  const needsCode = !!process.env.SIGNUP_CODE?.trim();
  return (
    <main className="container" style={{ maxWidth: 480, paddingTop: 40 }}>
      <h1>お店の登録</h1>
      <p className="muted">お店ごとに、予約・お客様・売上・スタッフを分けて管理できます。登録した方がそのお店のオーナーになります。</p>
      {p.error && <p className="notice error">{p.error}</p>}
      <form action={signupAction} className="card">
        <label>
          店名
          <input name="shopName" required maxLength={40} defaultValue={p.shopName} />
        </label>
        <label>
          URL名（予約フォームのアドレスになります。半角英小文字・数字・ハイフン。空欄なら自動）
          <input name="slug" maxLength={31} pattern="[a-z0-9][a-z0-9\-]{1,30}" defaultValue={p.slug} placeholder="例: bar-moon" autoCapitalize="none" spellCheck={false} />
        </label>
        <label>
          オーナーのお名前
          <input name="ownerName" required maxLength={30} defaultValue={p.ownerName} />
        </label>
        <label>
          ログインID（半角英数字3〜30文字）
          <input name="loginId" required minLength={3} maxLength={30} defaultValue={p.loginId} autoComplete="username" autoCapitalize="none" spellCheck={false} />
        </label>
        <label>
          パスワード（{MIN_PASSWORD_LENGTH}文字以上）
          <input type="password" name="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
        </label>
        <label>
          パスワード（確認）
          <input type="password" name="password2" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
        </label>
        {needsCode && (
          <label>
            登録コード（運営からお知らせしたもの）
            <input name="signupCode" required autoComplete="off" />
          </label>
        )}
        <button type="submit" className="primary">
          お店を登録する
        </button>
      </form>
      <p>
        すでに登録済みの方は <Link href="/owner/login">オーナーのログイン</Link>
      </p>
    </main>
  );
}
