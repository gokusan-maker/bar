"use client";

import { useEffect, useState } from "react";

/** 未提供の注文が増えたら音とバイブで知らせ、タブの題名に件数を出す */
export function NewOrderAlert({ waiting }: { waiting: number }) {
  const [sound, setSound] = useState(false);

  useEffect(() => {
    document.title = waiting ? `(${waiting}) 注文` : "注文";
    let previous = 0;
    try {
      previous = Number(sessionStorage.getItem("bar-waiting-orders") ?? waiting);
      sessionStorage.setItem("bar-waiting-orders", String(waiting));
    } catch {
      previous = waiting;
    }
    if (waiting <= previous) return;
    navigator.vibrate?.([200, 100, 200]);
    if (!sound) return;
    // 音は一度画面をタップして許可したあとだけ鳴らせる（ブラウザの決まり）
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    setTimeout(() => void ctx.close(), 500);
  }, [waiting, sound]);

  return sound ? (
    <p className="muted">新しい注文は音でお知らせします。</p>
  ) : (
    <button type="button" onClick={() => setSound(true)}>
      🔔 新しい注文を音で知らせる
    </button>
  );
}
