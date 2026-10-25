import { NextResponse } from "next/server";
import { promoService, reservationService } from "@/lib/container";
import { cronAuthorized, forEachShop } from "@/lib/cron";

/** 毎日12時に呼ばれる（wrangler.jsonc の cron → worker.ts）: 店舗ごとに、翌日のリマインド、誕生日のお祝い、古い個人情報の削除、12時設定の集客配信 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const shops = await forEachShop(async () => {
    const service = reservationService();
    const sent = await service.sendReminders();
    const birthdays = await service.sendBirthdayGreetings();
    const purged = await service.purgeExpiredPersonalData();
    const promo = await (await promoService()).runScheduled("noon");
    return { sent, birthdays, purged, promo };
  });
  return NextResponse.json({ shops });
}
