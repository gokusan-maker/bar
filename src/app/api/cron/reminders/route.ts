import { NextResponse } from "next/server";
import { reservationService } from "@/lib/container";

/** Vercel Cron から毎日12時に呼ばれる（vercel.json）: 翌日のリマインドと、古い個人情報の削除 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const service = reservationService();
  const sent = await service.sendReminders();
  const purged = await service.purgeExpiredPersonalData();
  return NextResponse.json({ sent, purged });
}
