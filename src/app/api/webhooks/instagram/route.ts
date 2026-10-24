import { DEFAULT_SHOP_ID } from "@/lib/domain/types";
import { instagramWebhook, instagramWebhookVerify } from "@/lib/webhooks";

/** 1店舗だったころのWebhook URL（店舗1） */
export function GET(req: Request) {
  return instagramWebhookVerify(req, DEFAULT_SHOP_ID);
}

export function POST(req: Request) {
  return instagramWebhook(req, DEFAULT_SHOP_ID);
}
