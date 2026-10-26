import Link from "next/link";

/** 規約などの読み物ページの枠 */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="container legal" style={{ maxWidth: 760, paddingTop: 32, paddingBottom: 48 }}>
      <p>
        <Link href="/">← トップへ</Link>
      </p>
      <h1>{title}</h1>
      <p className="muted">最終更新日：{updated}</p>
      {children}
    </main>
  );
}
