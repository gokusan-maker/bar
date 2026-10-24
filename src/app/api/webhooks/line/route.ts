import { DEFAULT_SHOP_ID } from "@/lib/domain/types";
import { lineWebhook } from "@/lib/webhooks";

/** 1店舗だったころのWebhook URL（店舗1） */
export function POST(req: Request) {
  return lineWebhook(req, DEFAULT_SHOP_ID);
}
