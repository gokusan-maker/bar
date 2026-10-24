import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { repository } from "@/lib/container";
import { ORDER_STATUS_LABEL } from "@/lib/domain/types";
import { businessDayStart, placeOrder } from "@/lib/order-service";
import { MenuForm } from "./menu-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ご注文", robots: { index: false } };

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const { done, error } = await searchParams;
  const repo = repository();
  const [settings, table] = await Promise.all([repo.getSettings(), repo.getOrderTableByToken(token)]);

  async function order(formData: FormData) {
    "use server";
    const items = [...formData.entries()]
      .filter(([k]) => k.startsWith("qty_"))
      .map(([k, v]) => ({ menuItemId: k.slice(4), qty: Number(v) }));
    const result = await placeOrder(repository(), { token, items, note: String(formData.get("note") ?? "") });
    redirect(`/order/${encodeURIComponent(token)}?${result.ok ? "done=1" : `error=${encodeURIComponent(result.error)}`}`);
  }

  if (!table || !table.active) {
    return (
      <main className="container" style={{ maxWidth: 520, paddingTop: 32 }}>
        <h1>{settings.shopName}</h1>
        <p className="notice error">このQRコードは使えません。お手数ですがスタッフにお声がけください。</p>
      </main>
    );
  }

  const [menu, orders] = await Promise.all([
    repo.listMenu(),
    repo.listOrders({ tableId: table.id, since: businessDayStart(), limit: 50 }),
  ]);
  const items = menu.filter((m) => m.available).map(({ id, name, category, price }) => ({ id, name, category, price }));
  const tonight = orders.filter((o) => o.status !== "cancelled");

  return (
    <main className="container" style={{ maxWidth: 520, paddingTop: 24, paddingBottom: 96 }}>
      <h1 style={{ marginBottom: 4 }}>{settings.shopName}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {table.name}　ご注文
      </p>
      {done && <p className="notice success">ご注文を受け付けました。お席までお持ちします。</p>}
      {done && settings.lineFriendUrl && (
        <p className="card" style={{ textAlign: "center" }}>
          LINEの友だち追加で、空き状況やお得な情報をお届けします
          <br />
          <a className="button line-button" href={settings.lineFriendUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8 }}>
            LINEで友だち追加
          </a>
        </p>
      )}
      {error && <p className="notice error">{error}</p>}
      {!settings.orderingEnabled ? (
        <p className="notice">ただいまこちらからのご注文は受け付けていません。スタッフにお声がけください。</p>
      ) : items.length === 0 ? (
        <p className="notice">メニューの準備中です。スタッフにお声がけください。</p>
      ) : (
        <MenuForm items={items} action={order} />
      )}
      {tonight.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>このお席の本日のご注文</h2>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {tonight.map((o) => (
              <li key={o.id}>
                {o.lines.map((l) => `${l.name}×${l.qty}`).join("、")}（{yen(o.total)}・{ORDER_STATUS_LABEL[o.status]}）
              </li>
            ))}
          </ul>
          <p style={{ marginBottom: 0 }}>
            合計 <strong>{yen(tonight.reduce((n, o) => n + o.total, 0))}</strong>
            <span className="muted">（お会計はチャージ・サービス料が加わります）</span>
          </p>
        </section>
      )}
    </main>
  );
}
