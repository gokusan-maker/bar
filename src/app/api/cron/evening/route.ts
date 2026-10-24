import { NextResponse } from "next/server";
import { promoService, reservationService } from "@/lib/container";

/** 開店前（17時）: カレンダーでの変更の取り込み、未反映分の再同期、今夜の予約一覧の通知、17時設定の集客配信 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const service = reservationService();
  const pulled = await service.pullCalendarChanges();
  const synced = await service.retryCalendarSync();
  const digest = await service.sendDailyDigest();
  const promo = await promoService().runScheduled("evening");
  return NextResponse.json({ pulled, synced, digestSent: digest !== null, promo });
}
