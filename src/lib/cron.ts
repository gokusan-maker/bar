import "server-only";
import { directory } from "./container";
import { withShop } from "./shop-context";

/** 定期処理の認証（Cloudflare の cron から CRON_SECRET 付きで呼ばれる） */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

/** 利用中の店舗それぞれで処理する。1店舗の失敗でほかの店舗が止まらないようにする */
export async function forEachShop<T>(job: (shopId: string) => Promise<T>): Promise<Record<string, T | { error: string }>> {
  const result: Record<string, T | { error: string }> = {};
  for (const shop of await directory().listShops()) {
    if (!shop.active) continue;
    try {
      result[shop.slug] = await withShop(shop.id, () => job(shop.id));
    } catch (error) {
      console.error(`cron failed for shop ${shop.slug}`, error);
      result[shop.slug] = { error: (error as Error).message };
    }
  }
  return result;
}
