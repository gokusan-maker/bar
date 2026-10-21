import { requireAdmin } from "@/lib/auth";
import { repository } from "@/lib/container";
import type { Staff } from "@/lib/domain/types";
import { saveStaffAction } from "../sales-actions";

function RateFields({ s }: { s?: Staff }) {
  const r = s?.backRates ?? { drink: 0, charge: 0, service: 0, perVisit: 0 };
  return (
    <div className="grid2">
      <label>
        お酒バック（%）
        <input name="drink" inputMode="decimal" defaultValue={r.drink} />
      </label>
      <label>
        料金バック（%）
        <input name="charge" inputMode="decimal" defaultValue={r.charge} />
      </label>
      <label>
        サービス料バック（%）
        <input name="service" inputMode="decimal" defaultValue={r.service} />
      </label>
      <label>
        1組ごとの固定バック（円）
        <input name="perVisit" inputMode="numeric" defaultValue={r.perVisit} />
      </label>
    </div>
  );
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await searchParams;
  const staff = await repository().listStaff();
  return (
    <>
      <h1>スタッフとバック率</h1>
      <p className="muted">
        お客様の担当スタッフに、売上の項目ごとの割合と1組ごとの固定額でバックを計算します。担当はお客様の画面か、売上の入力時に選びます。
      </p>
      {saved && <p className="notice success">保存しました</p>}
      {error && <p className="notice error">{error}</p>}

      {staff.map((s) => (
        <form key={s.id} action={saveStaffAction} className="card" style={{ opacity: s.active ? 1 : 0.6 }}>
          <input type="hidden" name="id" value={s.id} />
          <label>
            名前
            <input name="name" required defaultValue={s.name} />
          </label>
          <RateFields s={s} />
          <label>
            <input type="checkbox" name="active" defaultChecked={s.active} />
            在籍中（外すと選択肢に出なくなります。過去の売上は残ります）
          </label>
          <button type="submit">保存</button>
        </form>
      ))}

      <form action={saveStaffAction} className="card">
        <h2 style={{ marginTop: 0 }}>スタッフを追加</h2>
        <label>
          名前
          <input name="name" required />
        </label>
        <RateFields />
        <button type="submit" className="primary">
          追加
        </button>
      </form>
    </>
  );
}
