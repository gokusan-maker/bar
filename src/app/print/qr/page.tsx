import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { appBaseUrl, repository } from "@/lib/container";
import { qrSvg } from "@/lib/qr";
import { PrintButton } from "../back/print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "注文用QRコード", robots: { index: false } };

/** 席に置く注文用QRコードの印刷ページ */
export default async function QrPrintPage() {
  await requireAdmin();
  const repo = repository();
  const [tables, settings] = await Promise.all([repo.listOrderTables(), repo.getSettings()]);
  const base = appBaseUrl();
  return (
    <main className="print-sheet">
      <div className="no-print row" style={{ marginBottom: 16 }}>
        <Link className="button" href="/admin/menu">
          ← メニューに戻る
        </Link>
        <PrintButton />
      </div>
      {!base && <p className="notice error">APP_BASE_URL が未設定のため、QRコードを作れません。</p>}
      <div className="qr-grid">
        {base &&
          tables
            .filter((t) => t.active)
            .map((t) => (
              <div key={t.id} className="qr-card">
                <div className="qr-shop">{settings.shopName}</div>
                <div dangerouslySetInnerHTML={{ __html: qrSvg(`${base}/order/${t.token}`, 180) }} />
                <div className="qr-table">{t.name}</div>
                <div>スマホで読み取ってご注文ください</div>
              </div>
            ))}
      </div>
    </main>
  );
}
