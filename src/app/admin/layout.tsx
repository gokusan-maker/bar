import Link from "next/link";
import { authMode, currentSession, requireStaff } from "@/lib/auth";
import { googleOAuthConfig, isMemoryMode } from "@/lib/container";
import { logoutAction } from "./actions";
import { TabBar } from "./tabbar";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const role = await requireStaff();
  const owner = role === "owner";
  const staffName = owner ? null : (await currentSession())?.staffName;
  const warnings = !owner ? [] : [
    isMemoryMode() && "データベース未接続のため、データはメモリに保存されています（再起動で消えます）。",
    authMode() === "open-dev" && "ADMIN_PASSWORD 未設定のため、ログインなしで表示しています（開発モード）。",
    !process.env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY 未設定のため、無料の簡易読み取りで動いています（AIは使っていません）。",
    !googleOAuthConfig() && "Googleカレンダー連携の環境変数が未設定です。",
  ].filter(Boolean);
  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <strong>予約管理{owner ? "" : `（${staffName ?? "スタッフ"}）`}</strong>
          <Link href="/admin">予約一覧</Link>
          {owner && (
            <>
              <Link href="/admin/new">手動登録</Link>
              <Link href="/admin/post">空き投稿</Link>
              <Link href="/admin/sales">売上・バック</Link>
              <Link href="/admin/customers">お客様</Link>
              <Link href="/admin/inbox">メッセージ</Link>
              <Link href="/admin/simulator">テスト送信</Link>
              <Link href="/admin/staff">スタッフ</Link>
              <Link href="/admin/history">履歴</Link>
              <Link href="/admin/settings">設定</Link>
            </>
          )}
          {authMode() === "password" && (
            <form action={logoutAction} className="inline">
              <button type="submit" style={{ minHeight: 32, padding: "2px 10px" }}>
                ログアウト
              </button>
            </form>
          )}
        </div>
      </nav>
      <main className={`container${owner ? " with-tabbar" : ""}`}>
        {warnings.length > 0 && (
          <details className="notice">
            <summary>セットアップが未完了の項目があります（{warnings.length}件）</summary>
            <p style={{ margin: "8px 0 0" }}>
              <Link href="/admin/diagnostics">セットアップ診断で詳しく確認する →</Link>
            </p>
            <ul>
              {warnings.map((w) => (
                <li key={String(w)}>{w}</li>
              ))}
            </ul>
          </details>
        )}
        {children}
      </main>
      {owner && <TabBar />}
    </>
  );
}
