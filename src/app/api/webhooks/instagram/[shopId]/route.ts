import { instagramWebhook, instagramWebhookVerify } from "@/lib/webhooks";

/** 店舗ごとのInstagram Webhook URL（設定画面に表示） */
export async function GET(req: Request, { params }: { params: Promise<{ shopId: string }> }) {
  return instagramWebhookVerify(req, (await params).shopId);
}

export async function POST(req: Request, { params }: { params: Promise<{ shopId: string }> }) {
  return instagramWebhook(req, (await params).shopId);
}
