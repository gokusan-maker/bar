import { requireAdmin } from "@/lib/auth";
import { createManualAction } from "../actions";

export default async function NewReservationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const p = await searchParams;
  return (
    <>
      <h1>予約を手動で登録</h1>
      <p className="muted">電話・来店で受けた予約を登録します。Googleカレンダーにも反映されます。</p>
      {p.error && <p className="notice error">{p.error}</p>}
      <form action={createManualAction} className="card">
        <div className="grid2">
          <label>
            来店日（営業日）
            <input type="date" name="date" required defaultValue={p.date} />
          </label>
          <label>
            時刻（深夜1時は 25:00）
            <input name="time" required placeholder="21:00" pattern="\d{1,2}:\d{2}" defaultValue={p.time} />
          </label>
          <label>
            人数
            <input type="number" name="partySize" min={1} required defaultValue={p.partySize ?? 2} />
          </label>
          <label>
            お名前
            <input name="name" required defaultValue={p.name} />
          </label>
        </div>
        <label>
          要望・メモ
          <textarea name="notes" rows={2} defaultValue={p.notes} />
        </label>
        <label>
          <input type="checkbox" name="force" />
          満席・営業時間外でも登録する（強制登録）
        </label>
        <button type="submit" className="primary">
          登録する
        </button>
      </form>
    </>
  );
}
