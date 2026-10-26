import { adsEnabledFor, type AdPlace } from "@/lib/ads";
import { AdSlot } from "./ad-slot";

/** その場所で広告が有効なら広告枠を置く（サーバー側で判断） */
export function Ad({ place }: { place: AdPlace }) {
  const config = adsEnabledFor(place);
  return config ? <AdSlot client={config.client} slot={config.slot} /> : null;
}
