import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 今の処理がどの店舗のものか。ログイン中の画面ではセッションから決まるので不要で、
 * 予約フォーム・QR注文・Webhook・定期処理など、ログインのない処理で店舗を決めるのに使う。
 */
const store = new AsyncLocalStorage<string>();

export function withShop<T>(shopId: string, fn: () => Promise<T>): Promise<T> {
  return store.run(shopId, fn);
}

export function contextShopId(): string | undefined {
  return store.getStore();
}
