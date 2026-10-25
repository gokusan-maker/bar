import { lineWebhook } from "@/lib/webhooks";

/** 店舗ごとのLINE Webhook URL（設定画面に表示） */
export async function POST(req: Request, { params }: { params: Promise<{ shopId: string }> }) {
  return lineWebhook(req, (await params).shopId);
}
