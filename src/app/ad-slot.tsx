"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** AdSense の広告枠。読み込みは layout の script に任せ、ここでは枠を置いて表示を頼むだけ */
export function AdSlot({ client, slot }: { client: string; slot: string }) {
  const ref = useRef<HTMLModElement>(null);
  useEffect(() => {
    // 同じ枠に二度頼まないように
    if (!ref.current || ref.current.dataset.adsbygoogleStatus) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // 広告ブロッカーなどで読み込めなくても画面は動かす
    }
  }, []);
  return (
    <aside className="ad-slot" aria-label="広告">
      <span className="ad-label">広告</span>
      <ins ref={ref} className="adsbygoogle" style={{ display: "block" }} data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
    </aside>
  );
}
