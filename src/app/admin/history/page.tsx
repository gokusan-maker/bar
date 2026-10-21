import { requireAdmin } from "@/lib/auth";
import { repository } from "@/lib/container";
import { HistoryList } from "../history-list";

export default async function HistoryPage() {
  await requireAdmin();
  const logs = await repository().listAudit({ limit: 300 });
  return (
    <>
      <h1>操作履歴</h1>
      <p className="muted">予約の受付・変更、承認、売上の登録・修正、設定変更などの記録です（新しい順に300件）。</p>
      <section className="card">
        <HistoryList logs={logs} links />
      </section>
    </>
  );
}
