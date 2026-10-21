import { requireAdmin } from "@/lib/auth";
import { repository, reservationService } from "@/lib/container";
import { simulatorSendAction } from "../actions";

/** LINE/Instagramをつながなくても、お客様からのメッセージを試せる画面 */
export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  await requireAdmin();
  const { user = "guest-1" } = await searchParams;
  const repo = repository();
  const customer = await repo.findOrCreateCustomer("simulator", user, `テスト客(${user})`);
  const messages = await repo.listMessages(customer.id, new Date(0), 100);
  const quickReplies = await reservationService().currentQuickReplies(customer.id);

  return (
    <>
      <h1>テスト送信</h1>
      <p className="muted">
        お客様になりきってメッセージを送り、自動返信と予約登録の動きを確認できます。例: 「土曜の9時から2名でお願いします。山田です」
      </p>
      <section className="card">
        <div className="chat">
          {messages.length === 0 && <p className="muted">まだメッセージはありません</p>}
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.direction === "in" ? "out" : "in"}`}>
              {m.text}
            </div>
          ))}
        </div>
        {quickReplies.length > 0 && (
          <div className="row" style={{ marginTop: 12 }} aria-label="タップで返信">
            {quickReplies.map((q) => (
              <form key={q.label} action={simulatorSendAction} className="inline">
                <input type="hidden" name="userId" value={user} />
                <input type="hidden" name="text" value={q.text} />
                <button type="submit" className="chip">
                  {q.label}
                </button>
              </form>
            ))}
          </div>
        )}
        <form action={simulatorSendAction} style={{ marginTop: 16 }}>
          <label>
            テスト客ID（変えると別のお客様として送信）
            <input name="userId" defaultValue={user} />
          </label>
          <label>
            メッセージ
            <textarea name="text" rows={3} required autoFocus />
          </label>
          <button type="submit" className="primary">
            送信
          </button>
        </form>
      </section>
    </>
  );
}
