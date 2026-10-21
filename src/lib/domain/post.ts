import type { SlotAvailability } from "./availability";
import { weekdayJa, weekdayOf } from "./time";
import type { ShopSettings } from "./types";

/** 残り席数の目安記号 */
export function seatMark(remaining: number, capacity: number): string {
  if (remaining <= 0) return "×";
  if (remaining >= capacity / 2) return "◎";
  if (remaining >= 3) return "○";
  return "△";
}

const clockLabel = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return h >= 24 ? `${h - 24}:${String(m).padStart(2, "0")}` : clock;
};

/** 予約の案内。LINEがあればLINEを一番に出す */
function bookingLines(o: { reserveUrl: string | null; lineUrl?: string | null }): string[] {
  if (o.lineUrl) {
    return [`ご予約はLINEで👇`, o.lineUrl, ...(o.reserveUrl ? [`Webからも予約OK ${o.reserveUrl}`] : [])];
  }
  return [o.reserveUrl ? `ご予約はDMか ${o.reserveUrl} から` : "ご予約はDMでお気軽にどうぞ！"];
}

/** Instagramのストーリーズ・Xなどに貼る「空き状況」の文面 */
export function availabilityPost(
  settings: Pick<ShopSettings, "shopName" | "capacity">,
  businessDate: string,
  slots: SlotAvailability[],
  options: { isToday: boolean; reserveUrl: string | null; lineUrl?: string | null },
): string {
  const [, m, d] = businessDate.split("-").map(Number);
  const day = `${m}/${d}(${weekdayJa(weekdayOf(businessDate))})`;
  const open = slots.filter((s) => s.remaining > 0);
  const head = `【${options.isToday ? "本日" : day}の空き状況】${settings.shopName}`;
  if (!open.length) {
    return `${head}\n${options.isToday ? "本日" : day}は満席となりました🙇\nまたのご来店をお待ちしております！`;
  }
  const lines = slots.map((s) => `${clockLabel(s.clock)}〜 ${seatMark(s.remaining, settings.capacity)}`);
  return [
    head,
    ...(options.isToday ? [day] : []),
    ...lines,
    "◎余裕あり ○空きあり △残りわずか ×満席",
    ...bookingLines(options),
  ].join("\n");
}
