import "server-only";

/**
 * 広告（Google AdSense）。ADSENSE_CLIENT（ca-pub-…）を入れたときだけ表示する。
 * 出す場所は AD_PLACES（カンマ区切り）で選ぶ。初期値は紹介ページと管理画面。
 *   landing … 紹介ページ（/）
 *   admin   … オーナー・スタッフの管理画面
 *   public  … お客様が見る予約フォーム・QR注文の画面
 */
export type AdPlace = "landing" | "admin" | "public";

export interface AdConfig {
  client: string;
  /** 広告ユニットのID（AdSense の「広告ユニット」で作ったもの） */
  slot: string;
  places: AdPlace[];
}

export function adConfig(): AdConfig | null {
  const client = process.env.ADSENSE_CLIENT?.trim();
  const slot = process.env.ADSENSE_SLOT?.trim();
  if (!client || !/^ca-pub-\d+$/.test(client) || !slot || !/^\d+$/.test(slot)) return null;
  const places = (process.env.AD_PLACES ?? "landing,admin")
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is AdPlace => p === "landing" || p === "admin" || p === "public");
  return { client, slot, places };
}

export function adsEnabledFor(place: AdPlace): AdConfig | null {
  const config = adConfig();
  return config && config.places.includes(place) ? config : null;
}
