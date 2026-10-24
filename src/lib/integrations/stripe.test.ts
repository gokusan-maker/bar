import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shopAccess } from "../domain/billing";
import { NO_BILLING } from "../domain/billing";
import { toBillingStatus, verifyStripeSignature } from "./stripe";

const sign = (payload: string, secret: string, t: number) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

describe("Stripe webhook signature", () => {
  const now = Date.UTC(2026, 9, 24);
  const t = Math.floor(now / 1000);
  it("accepts a valid recent signature and rejects tampering, old ones and wrong secrets", () => {
    const body = '{"type":"x"}';
    expect(verifyStripeSignature(body, sign(body, "whsec", t), "whsec", now)).toBe(true);
    expect(verifyStripeSignature(body + " ", sign(body, "whsec", t), "whsec", now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, "other", t), "whsec", now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, "whsec", t - 600), "whsec", now)).toBe(false);
    expect(verifyStripeSignature(body, null, "whsec", now)).toBe(false);
  });
  it("maps Stripe statuses", () => {
    expect(toBillingStatus("active")).toBe("active");
    expect(toBillingStatus("unpaid")).toBe("past_due");
    expect(toBillingStatus("incomplete_expired")).toBe("canceled");
  });
});

describe("shop access", () => {
  const now = new Date("2026-10-24T00:00:00Z");
  const b = (over: Partial<typeof NO_BILLING>) => ({ ...NO_BILLING, exempt: false, ...over });
  it("is always ok when billing is off or the shop is exempt", () => {
    expect(shopAccess(b({ status: "canceled" }), now, false)).toBe("ok");
    expect(shopAccess({ ...NO_BILLING, status: "canceled" }, now, true)).toBe("ok");
  });
  it("handles trial, payment, grace and cancellation", () => {
    expect(shopAccess(b({ status: "trialing", trialEndsAt: "2026-11-01T00:00:00Z" }), now, true)).toBe("trial");
    expect(shopAccess(b({ status: "trialing", trialEndsAt: "2026-10-20T00:00:00Z" }), now, true)).toBe("locked");
    expect(shopAccess(b({ status: "active" }), now, true)).toBe("ok");
    expect(shopAccess(b({ status: "past_due", currentPeriodEnd: "2026-10-20T00:00:00Z" }), now, true)).toBe("grace");
    expect(shopAccess(b({ status: "past_due", currentPeriodEnd: "2026-10-10T00:00:00Z" }), now, true)).toBe("locked");
    expect(shopAccess(b({ status: "canceled", currentPeriodEnd: "2026-10-30T00:00:00Z" }), now, true)).toBe("ok");
    expect(shopAccess(b({ status: "canceled", currentPeriodEnd: "2026-10-01T00:00:00Z" }), now, true)).toBe("locked");
  });
});
