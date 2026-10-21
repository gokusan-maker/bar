import { requireAdmin } from "@/lib/auth";
import { runDiagnostics, type Check } from "@/lib/diagnostics";

const MARK: Record<Check["status"], { label: string; className: string }> = {
  ok: { label: "OK", className: "badge badge-confirmed" },
  warn: { label: "注意", className: "badge badge-pending" },
  error: { label: "要対応", className: "badge badge-rejected" },
  off: { label: "未使用", className: "badge" },
};

export default async function DiagnosticsPage() {
  await requireAdmin();
  const checks = await runDiagnostics();
  const problems = checks.filter((c) => c.status === "error").length;
  return (
    <>
      <h1>セットアップ診断</h1>
      <p className="muted">
        本番の各サービスに正しくつながっているかを確認します（料金のかからない確認用の通信だけを使います）。ページを開き直すと再確認します。
      </p>
      <p className={`notice ${problems ? "error" : "success"}`}>
        {problems ? `対応が必要な項目が ${problems} 件あります` : "必要な設定はそろっています"}
      </p>
      <section className="card">
        <ul className="list">
          {checks.map((c) => (
            <li key={c.name}>
              <div className="row">
                <span className={MARK[c.status].className}>{MARK[c.status].label}</span>
                <strong>{c.name}</strong>
              </div>
              <div className="muted">{c.detail}</div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
