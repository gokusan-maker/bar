import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { repository } from "@/lib/container";
import { yen } from "@/lib/domain/sales";
import type { Order } from "@/lib/domain/types";
import { businessDayStart } from "@/lib/order-service";
import { AutoRefresh } from "../auto-refresh";
import { setOrderStatusAction } from "../order-actions";

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

function StatusButton({ order, status, label, primary }: { order: Order; status: string; label: string; primary?: boolean }) {
  return (
    <form action={setOrderStatusAction} className="inline">
      <input type="hidden" name="id" value={order.id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={primary ? "primary" : undefined}>
        {label}
      </button>
    </form>
  );
}

export default async function OrdersPage() {
  const role = await requireStaff();
  const repo = repository();
  const [orders, settings] = await Promise.all([repo.listOrders({ since: businessDayStart(), limit: 500 }), repo.getSettings()]);
  const waiting = orders.filter((o) => o.status === "new").reverse();
  const served = orders.filter((o) => o.status === "served");
  // 席ごとの本日の合計（取消を除く）。会計で売上に取り込む
  const byTable = new Map<string, { name: string; orders: Order[] }>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const t = byTable.get(o.tableId) ?? { name: o.tableName, orders: [] };
    t.orders.push(o);
    byTable.set(o.tableId, t);
  }

  return (
    <>
      <AutoRefresh seconds={15} />
      <div className="row spread">
        <h1 style={{ margin: 0 }}>注文（本日）</h1>
        {role === "owner" && (
          <Link className="button" href="/admin/menu">
            メニュー・QRコード
          </Link>
        )}
      </div>
      {!settings.orderingEnabled && <p className="notice">注文の受付を止めています（メニュー・QRコードの画面で再開できます）。</p>}
      <p className="muted">15秒ごとに自動で更新します。</p>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>未提供 {waiting.length}件</h2>
        {waiting.length === 0 && <p className="muted">未提供の注文はありません。</p>}
        {waiting.map((o) => (
          <div key={o.id} className="order-ticket">
            <div className="row spread">
              <strong>{o.tableName}</strong>
              <span className="muted">{clock(o.createdAt)}</span>
            </div>
            <ul>
              {o.lines.map((l) => (
                <li key={l.menuItemId}>
                  {l.name} × <strong>{l.qty}</strong>
                </li>
              ))}
            </ul>
            {o.note && <p className="notice">ご要望: {o.note}</p>}
            <div className="row">
              <StatusButton order={o} status="served" label="提供済みにする" primary />
              <StatusButton order={o} status="cancelled" label="取消" />
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>席ごとの合計</h2>
        {byTable.size === 0 && <p className="muted">本日の注文はまだありません。</p>}
        {[...byTable].map(([tableId, t]) => {
          const open = t.orders.filter((o) => !o.saleId);
          const total = open.reduce((n, o) => n + o.total, 0);
          return (
            <div key={tableId} className="row spread order-ticket">
              <span>
                <strong>{t.name}</strong>　{open.length}件 {yen(total)}
                {t.orders.length > open.length && <span className="muted">（売上に取り込み済み {t.orders.length - open.length}件）</span>}
              </span>
              {role === "owner" && open.length > 0 && (
                <Link className="button primary" href={`/admin/sales/new?orders=${open.map((o) => o.id).join(",")}`}>
                  会計（売上に取り込む）
                </Link>
              )}
            </div>
          );
        })}
      </section>

      {served.length > 0 && (
        <details className="card">
          <summary>提供済み {served.length}件</summary>
          {served.map((o) => (
            <div key={o.id} className="row spread order-ticket">
              <span>
                {clock(o.createdAt)} {o.tableName}：{o.lines.map((l) => `${l.name}×${l.qty}`).join("、")}
              </span>
              {!o.saleId && <StatusButton order={o} status="new" label="未提供に戻す" />}
            </div>
          ))}
        </details>
      )}
    </>
  );
}
