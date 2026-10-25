"use client";

import { useState } from "react";

export interface GuestMenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

/** メニューを選んで数を決める。数は隠し欄で送り、値段はサーバーがメニューから決め直す */
export function MenuForm({ items, action }: { items: GuestMenuItem[]; action: (formData: FormData) => Promise<void> }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [sending, setSending] = useState(false);
  const change = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(20, (q[id] ?? 0) + d)) }));
  const chosen = items.filter((m) => qty[m.id]);
  const total = chosen.reduce((n, m) => n + m.price * qty[m.id], 0);
  const count = chosen.reduce((n, m) => n + qty[m.id], 0);
  const categories = [...new Set(items.map((m) => m.category || "メニュー"))];

  return (
    <form action={action} onSubmit={() => setSending(true)} className="order-form">
      {categories.map((c) => (
        <section key={c} className="card">
          <h2 style={{ marginTop: 0 }}>{c}</h2>
          {items
            .filter((m) => (m.category || "メニュー") === c)
            .map((m) => (
              <div key={m.id} className="order-item">
                <div>
                  <div>{m.name}</div>
                  <div className="muted">{yen(m.price)}</div>
                </div>
                <div className="qty">
                  <button type="button" onClick={() => change(m.id, -1)} disabled={!qty[m.id]} aria-label={`${m.name}を1つ減らす`}>
                    −
                  </button>
                  <span aria-live="polite">{qty[m.id] ?? 0}</span>
                  <button type="button" onClick={() => change(m.id, 1)} aria-label={`${m.name}を1つ増やす`}>
                    ＋
                  </button>
                </div>
              </div>
            ))}
        </section>
      ))}
      {chosen.map((m) => (
        <input key={m.id} type="hidden" name={`qty_${m.id}`} value={qty[m.id]} />
      ))}
      <label className="card" style={{ display: "block" }}>
        ご要望（任意）
        <input name="note" maxLength={200} placeholder="例: 氷少なめ、ソーダ割りで" />
      </label>
      <div className="order-bar">
        <span>
          {count}点　<strong>{yen(total)}</strong>
        </span>
        <button type="submit" className="primary" disabled={!count || sending}>
          {sending ? "送信中…" : "注文する"}
        </button>
      </div>
    </form>
  );
}
