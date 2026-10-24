import type { ShopBilling } from "./types";

/** 支払いが遅れても使い続けられる日数（カードの更新などのため） */
export const GRACE_DAYS = 7;

export type Access = "ok" | "trial" | "grace" | "locked";

/**
 * お店を使えるかどうか。支払いの仕組み（Stripe）を使っていなければ常に使える。
 * - trial: 無料期間中
 * - grace: 支払いが遅れているが、猶予期間中（オーナーに支払いを促す）
 * - locked: 無料期間が終わった・解約した・猶予が過ぎた（支払うまで管理画面と予約受付を止める）
 */
export function shopAccess(billing: ShopBilling, now: Date, billingEnabled: boolean): Access {
  if (!billingEnabled || billing.exempt) return "ok";
  const t = now.getTime();
  const graceUntil = (iso: string | null) => (iso ? new Date(iso).getTime() + GRACE_DAYS * 86400_000 : 0);
  switch (billing.status) {
    case "active":
      return "ok";
    case "trialing":
      if (!billing.trialEndsAt || new Date(billing.trialEndsAt).getTime() > t) return "trial";
      // Stripe の無料期間（カード登録済み）なら、期間の終わりまで使える
      if (billing.stripeSubscriptionId && billing.currentPeriodEnd && new Date(billing.currentPeriodEnd).getTime() > t) return "trial";
      return "locked";
    case "past_due":
      return graceUntil(billing.currentPeriodEnd) > t ? "grace" : "locked";
    case "canceled":
      // 解約しても、支払い済みの期間の終わりまでは使える
      return billing.currentPeriodEnd && new Date(billing.currentPeriodEnd).getTime() > t ? "ok" : "locked";
  }
}

/** 無料期間の残り日数（切り上げ） */
export function trialDaysLeft(billing: ShopBilling, now: Date): number | null {
  if (!billing.trialEndsAt) return null;
  return Math.max(0, Math.ceil((new Date(billing.trialEndsAt).getTime() - now.getTime()) / 86400_000));
}

export const NO_BILLING: ShopBilling = {
  status: "active",
  trialEndsAt: null,
  exempt: true,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
};
