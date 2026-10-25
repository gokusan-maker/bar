import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { appBaseUrl, repository } from "@/lib/container";
import { yen } from "@/lib/domain/sales";
import type { MenuItem } from "@/lib/domain/types";
import { qrSvg } from "@/lib/qr";
import { CopyButton } from "../copy-button";
import {
  deleteMenuItemAction,
  renewTableTokenAction,
  saveMenuItemAction,
  saveOrderTableAction,
  toggleOrderingAction,
} from "../order-actions";

const SAVED: Record<string, string> = { "1": "保存しました", qr: "QRコードを作り直しました。新しいQRコードを印刷して貼り替えてください" };

function MenuFields({ m }: { m?: MenuItem }) {
  return (
    <div className="grid2">
      <label>
        品名
        <input name="name" required maxLength={40} defaultValue={m?.name} />
      </label>
      <label>
        分類（例: ビール、カクテル）
        <input name="category" maxLength={20} defaultValue={m?.category} list="menu-categories" />
      </label>
      <label>
        値段（円）
        <input name="price" inputMode="numeric" required defaultValue={m?.price} />
      </label>
      <label>
        並び順（小さいほど上）
        <input name="sortOrder" inputMode="numeric" defaultValue={m?.sortOrder ?? 0} />
      </label>
    </div>
  );
}

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requireAdmin();
  const { saved, error } = await searchParams;
  const repo = repository();
  const [menu, tables, settings] = await Promise.all([repo.listMenu(), repo.listOrderTables(), repo.getSettings()]);
  const base = appBaseUrl();
  const categories = [...new Set(menu.map((m) => m.category).filter(Boolean))];

  return (
    <>
      <h1>メニュー・注文用QRコード</h1>
      <p className="muted">
        席ごとのQRコード（またはURL）をお客様がスマホで開くと、メニューから注文できます。注文は「注文」画面に届きます。
      </p>
      {saved && <p className="notice success">{SAVED[saved] ?? SAVED["1"]}</p>}
      {error && <p className="notice error">{error}</p>}

      <section className="card">
        <div className="row spread">
          <strong>注文の受付：{settings.orderingEnabled ? "受付中" : "停止中"}</strong>
          <form action={toggleOrderingAction}>
            <input type="hidden" name="enabled" value={settings.orderingEnabled ? "0" : "1"} />
            <button type="submit">{settings.orderingEnabled ? "受付を止める" : "受付を始める"}</button>
          </form>
        </div>
      </section>

      <h2>メニュー</h2>
      <datalist id="menu-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {menu.map((m) => (
        <details key={m.id} className="card" style={{ opacity: m.available ? 1 : 0.6 }}>
          <summary>
            {m.category && <span className="muted">{m.category}　</span>}
            {m.name}　{yen(m.price)}
            {!m.available && "（品切れ）"}
          </summary>
          <form action={saveMenuItemAction}>
            <input type="hidden" name="id" value={m.id} />
            <MenuFields m={m} />
            <label>
              <input type="checkbox" name="available" defaultChecked={m.available} />
              注文できる（外すと品切れとしてお客様の画面に出なくなります）
            </label>
            <div className="row">
              <button type="submit" className="primary">
                保存
              </button>
            </div>
          </form>
          <form action={deleteMenuItemAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={m.id} />
            <button type="submit">メニューから削除</button>
          </form>
        </details>
      ))}
      <form action={saveMenuItemAction} className="card">
        <h3 style={{ marginTop: 0 }}>メニューを追加</h3>
        <MenuFields />
        <button type="submit" className="primary">
          追加
        </button>
      </form>

      <div className="row spread">
        <h2>席とQRコード</h2>
        {tables.length > 0 && (
          <Link className="button" href="/print/qr">
            QRコードを印刷
          </Link>
        )}
      </div>
      {!base && <p className="notice error">APP_BASE_URL が未設定のため、QRコードを作れません。</p>}
      {tables.map((t) => {
        const url = base ? `${base}/order/${t.token}` : null;
        return (
          <section key={t.id} className="card" style={{ opacity: t.active ? 1 : 0.6 }}>
            <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
              {url && <div dangerouslySetInnerHTML={{ __html: qrSvg(url, 120) }} />}
              <form action={saveOrderTableAction} style={{ flex: 1, minWidth: 200 }}>
                <input type="hidden" name="id" value={t.id} />
                <label>
                  席の名前
                  <input name="name" required maxLength={30} defaultValue={t.name} />
                </label>
                <label>
                  <input type="checkbox" name="active" defaultChecked={t.active} />
                  使う（外すとこのQRコードから注文できません）
                </label>
                <button type="submit">保存</button>
              </form>
            </div>
            {url && (
              <p style={{ wordBreak: "break-all" }}>
                <code>{url}</code> <CopyButton text={url} />
              </p>
            )}
            <form action={renewTableTokenAction}>
              <input type="hidden" name="id" value={t.id} />
              <button type="submit">QRコードを作り直す（古いQRコードは使えなくなります）</button>
            </form>
          </section>
        );
      })}
      <form action={saveOrderTableAction} className="card">
        <h3 style={{ marginTop: 0 }}>席を追加</h3>
        <label>
          席の名前（例: カウンター1、テーブルA）
          <input name="name" required maxLength={30} />
        </label>
        <button type="submit" className="primary">
          追加
        </button>
      </form>
    </>
  );
}
