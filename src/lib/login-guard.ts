import "server-only";
import { headers } from "next/headers";
import { repository } from "./container";

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
  const repo = repository();
  const [byIp, total] = await Promise.all([
    repo.countLoginFailures(since, ip),
    repo.countLoginFailures(since),
  ]);
  return byIp >= MAX_FAILURES_PER_IP || total >= MAX_FAILURES_TOTAL;
}

export async function recordFailure(ip: string): Promise<void> {
  await repository().recordLoginFailure(ip);
}
