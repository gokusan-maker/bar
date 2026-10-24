import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe（月額の支払い）。SDKを使わずAPIを直接呼ぶ（Workersでそのまま動くように） */
export interface StripeConfig {
  secretKey: string;
  priceId: string;
  webhookSecret: string;
}

/** Stripe API はフォーム形式。入れ子は metadata[key]=value の形にする */
function form(params: Record<string, string | number | undefined>): string {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v));
  return body.toString();
}

async function call<T>(config: StripeConfig, path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form(params),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe ${path} ${res.status}: ${json.error?.message ?? ""}`);
  return json;
}

/** 月額の申し込み画面（Stripe Checkout）を作る。無料期間が残っていれば、その日から課金を始める */
export async function createCheckoutSession(
  config: StripeConfig,
  input: { shopId: string; customerId: string | null; email?: string; trialEnd: number | null; successUrl: string; cancelUrl: string },
): Promise<string> {
  const session = await call<{ url: string }>(config, "/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": config.priceId,
    "line_items[0][quantity]": 1,
    client_reference_id: input.shopId,
    "metadata[shop_id]": input.shopId,
    "subscription_data[metadata][shop_id]": input.shopId,
    // Stripe は無料期間の終わりを48時間以上先にする必要がある
    "subscription_data[trial_end]": input.trialEnd && input.trialEnd > Date.now() / 1000 + 2 * 86400 ? input.trialEnd : undefined,
    customer: input.customerId ?? undefined,
    customer_email: input.customerId ? undefined : input.email,
    locale: "ja",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  return session.url;
}

/** カードの変更・解約・領収書（Stripe のカスタマーポータル） */
export async function createPortalSession(config: StripeConfig, customerId: string, returnUrl: string): Promise<string> {
  const session = await call<{ url: string }>(config, "/billing_portal/sessions", { customer: customerId, return_url: returnUrl, locale: "ja" });
  return session.url;
}

/** Webhook の署名（Stripe-Signature: t=...,v1=...）を確かめる。5分より古いものは受け付けない */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
  const signatures = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => Buffer.from(p.slice(3), "hex"));
  return signatures.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
}

/** Stripe の契約の状態 → アプリの状態 */
export function toBillingStatus(stripeStatus: string): "trialing" | "active" | "past_due" | "canceled" {
  if (stripeStatus === "active") return "active";
  if (stripeStatus === "trialing") return "trialing";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid" || stripeStatus === "incomplete") return "past_due";
  return "canceled";
}
