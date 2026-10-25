import "server-only";
import { headers } from "next/headers";
import { shopRepository } from "./container";
import { DEFAULT_SHOP_ID } from "./domain/types";

// ログイン失敗の記録は店舗に関係なく1か所（店舗1の保存先）にまとめる
const failures = () => shopRepository(DEFAULT_SHOP_ID);

const WINDOW_MS = 15 * 60 * 1000;
/** 同じIPからの失敗回数の上限（15分あたり） */
export const MAX_FAILURES_PER_IP = 10;
/** すべてのIPを合わせた失敗回数の上限（分散した総当たり対策） */
export const MAX_FAILURES_TOTAL = 100;

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/** ロック中ならtrue */
export async function isLockedOut(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const repo = failures();
  const [byIp, total] = await Promise.all([
    repo.countLoginFailures(since, ip),
    repo.countLoginFailures(since),
  ]);
  return byIp >= MAX_FAILURES_PER_IP || total >= MAX_FAILURES_TOTAL;
}

export async function recordFailure(ip: string): Promise<void> {
  await failures().recordLoginFailure(ip);
}
