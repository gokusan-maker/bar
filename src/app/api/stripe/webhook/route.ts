import { NextResponse } from "next/server";
import { directory, stripeConfig } from "@/lib/container";
import { toBillingStatus, verifyStripeSignature } from "@/lib/integrations/stripe";

const iso = (unix: unknown) => (typeof unix === "number" ? new Date(unix * 1000).toISOString() : null);

interface StripeObject {
  id?: string;
  customer?: string;
  subscription?: string;
  client_reference_id?: string;
  status?: string;
  trial_end?: number | null;
  current_period_end?: number;
  metadata?: { shop_id?: string };
  items?: { data?: { current_period_end?: number }[] };
}

/** Stripe からのお知らせ（申し込み・更新・支払いの失敗・解約）で、お店の契約の状態を更新する */
export async function POST(req: Request) {
  const config = stripeConfig();
  if (!config) return NextResponse.json({ error: "billing is off" }, { status: 503 });
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), config.webhookSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const event = JSON.parse(raw) as { type: string; data: { object: StripeObject } };
  const obj = event.data.object;
  const dir = directory();

  if (event.type === "checkout.session.completed") {
    const shopId = obj.client_reference_id ?? obj.metadata?.shop_id;
    if (shopId && (await dir.getShop(shopId))) {
      await dir.updateBilling(shopId, { stripeCustomerId: obj.customer ?? null, stripeSubscriptionId: obj.subscription ?? null });
    }
  } else if (event.type.startsWith("customer.subscription.")) {
    const shopId = (obj.id && (await dir.findShopIdByStripeSubscription(obj.id))) || obj.metadata?.shop_id;
    if (shopId && (await dir.getShop(shopId))) {
      // 新しいAPIでは期間の終わりが items 側にある
      const periodEnd = obj.current_period_end ?? obj.items?.data?.[0]?.current_period_end;
      await dir.updateBilling(shopId, {
        status: event.type === "customer.subscription.deleted" ? "canceled" : toBillingStatus(obj.status ?? ""),
        stripeSubscriptionId: obj.id ?? null,
        stripeCustomerId: obj.customer ?? null,
        currentPeriodEnd: iso(periodEnd),
        ...(obj.trial_end ? { trialEndsAt: iso(obj.trial_end) } : {}),
      });
    }
  }
  return NextResponse.json({ received: true });
}
