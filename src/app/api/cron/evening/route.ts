import { NextResponse } from "next/server";
import { promoService, reservationService } from "@/lib/container";
import { cronAuthorized, forEachShop } from "@/lib/cron";

/** 開店前（17時）: 店舗ごとに、カレンダーでの変更の取り込み、未反映分の再同期、今夜の予約一覧の通知、17時設定の集客配信 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const shops = await forEachShop(async () => {
    const service = reservationService();
    const pulled = await service.pullCalendarChanges();
    const synced = await service.retryCalendarSync();
    const digest = await service.sendDailyDigest();
    const promo = await (await promoService()).runScheduled("evening");
    return { pulled, synced, digestSent: digest !== null, promo };
  });
  return NextResponse.json({ shops });
}
