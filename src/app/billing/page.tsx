import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { appBaseUrl, directory, shopAccessFor, stripeConfig } from "@/lib/container";
import { trialDaysLeft } from "@/lib/domain/billing";
import { createCheckoutSession, createPortalSession } from "@/lib/integrations/stripe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "お支払い", robots: { index: false } };

const STATUS_LABEL = { trialing: "無料期間", active: "ご契約中", past_due: "お支払いの確認待ち", canceled: "解約済み" };

/** オーナーだけが支払いの画面を開ける（スタッフには案内だけ出す） */
async function ownerShop() {
  const session = await currentSession();
  if (!session) redirect("/owner/login");
  if (session.role !== "owner") redirect("/billing");
  const shop = await directory().getShop(session.shopId);
  if (!shop) redirect("/owner/login");
  return shop;
}

async function subscribeAction() {
  "use server";
  const config = stripeConfig();
  const base = appBaseUrl();
  if (!config || !base) redirect("/billing?error=off");
  const shop = await ownerShop();
  const trialEnd = shop.billing.status === "trialing" && shop.billing.trialEndsAt ? Math.floor(new Date(shop.billing.trialEndsAt).getTime() / 1000) : null;
  const url = await createCheckoutSession(config, {
    shopId: shop.id,
    customerId: shop.billing.stripeCustomerId,
    trialEnd,
    successUrl: `${base}/billing?done=1`,
    cancelUrl: `${base}/billing`,
  });
  redirect(url);
}

async function portalAction() {
  "use server";
  const config = stripeConfig();
  const base = appBaseUrl();
  const shop = await ownerShop();
  if (!config || !base || !shop.billing.stripeCustomerId) redirect("/billing");
  redirect(await createPortalSession(config, shop.billing.stripeCustomerId, `${base}/billing`));
}

/** 月額のお支払い（Stripe） */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/owner/login");
  const { done, error } = await searchParams;
  const shop = await directory().getShop(session.shopId);
  if (!shop) redirect("/owner/login");
  const access = await shopAccessFor(shop.id);
  const enabled = !!stripeConfig();
  const price = process.env.PRICE_TEXT?.trim();
  const daysLeft = trialDaysLeft(shop.billing, new Date());

  return (
    <main className="container" style={{ maxWidth: 560, paddingTop: 40 }}>
      <h1>お支払い</h1>
      <p className="muted">{shop.name}</p>
      {done && <p className="notice success">お申し込みありがとうございます。反映まで少しお待ちください。</p>}
      {error === "off" && <p className="notice error">お支払いの仕組みが準備中です。運営にお問い合わせください。</p>}
      {access === "locked" && (
        <p className="notice error">
          {shop.active ? "無料期間が終わったか、ご契約が終了したため、管理画面とご予約の受付を止めています。" : "このお店の利用は止められています。運営にお問い合わせください。"}
        </p>
      )}
      {access === "grace" && <p className="notice error">お支払いが確認できていません。カード情報をご確認ください。</p>}

      {!enabled || shop.billing.exempt ? (
        <section className="card">
          <p style={{ margin: 0 }}>このお店はお支払いの必要はありません。</p>
        </section>
      ) : session.role !== "owner" ? (
        <section className="card">
          <p style={{ margin: 0 }}>お支払いの手続きはオーナーが行います。オーナーにご連絡ください。</p>
        </section>
      ) : (
        <section className="card">
          <p>
            状態：<strong>{STATUS_LABEL[shop.billing.status]}</strong>
            {shop.billing.status === "trialing" && daysLeft !== null && `（あと${daysLeft}日）`}
          </p>
          {shop.billing.currentPeriodEnd && shop.billing.status !== "trialing" && (
            <p>次の更新日：{shop.billing.currentPeriodEnd.slice(0, 10).replaceAll("-", "/")}</p>
          )}
          {price && <p className="muted">料金：{price}</p>}
          {shop.billing.stripeSubscriptionId && shop.billing.status !== "canceled" ? (
            <form action={portalAction}>
              <button type="submit">カードの変更・領収書・解約</button>
            </form>
          ) : (
            <form action={subscribeAction}>
              <button type="submit" className="primary">
                カードで月額のお申し込み{shop.billing.status === "trialing" && daysLeft ? `（無料期間のあとから課金）` : ""}
              </button>
            </form>
          )}
        </section>
      )}
      {access !== "locked" && (
        <p>
          <Link href="/admin">管理画面に戻る</Link>
        </p>
      )}
    </main>
  );
}
