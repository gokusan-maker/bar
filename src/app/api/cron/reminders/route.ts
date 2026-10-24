import { NextResponse } from "next/server";
import { promoService, reservationService } from "@/lib/container";

/** 毎日12時に呼ばれる（wrangler.jsonc の cron → worker.ts）: 翌日のリマインド、誕生日のお祝い、古い個人情報の削除、12時設定の集客配信 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const service = reservationService();
  const sent = await service.sendReminders();
  const birthdays = await service.sendBirthdayGreetings();
  const purged = await service.purgeExpiredPersonalData();
  const promo = await promoService().runScheduled("noon");
  return NextResponse.json({ sent, birthdays, purged, promo });
}
