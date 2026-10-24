import { requireAdmin } from "@/lib/auth";
import { repository } from "@/lib/container";
import { createCustomerAction } from "../../customer-actions";
import { CHANNEL_LABEL } from "../../ui";
import { ProfileFields } from "../profile-fields";

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { error } = await searchParams;
  const staff = (await repository().listStaff()).filter((s) => s.active && !s.pending);
  return (
    <>
      <h1>お客様を登録</h1>
      <p className="muted">電話予約・ご来店・ご紹介のお客様などを、お客様リストに登録します。SNSから予約したお客様は自動で登録されます。</p>
      {error && <p className="notice error">{error}</p>}
      <form action={createCustomerAction} className="card">
        <ProfileFields />
        <div className="grid2">
          <label>
            知ったきっかけ（集客経路）
            <select name="channel" defaultValue="line">
              {(["line", "instagram", "x", "web", "manual"] as const).map((c) => (
                <option key={c} value={c}>
                  {c === "manual" ? "SNS以外（電話・来店・紹介）" : CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            担当スタッフ
            <select name="staffId" defaultValue="">
              <option value="">なし</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <input type="checkbox" name="allowDuplicate" />
          同じ電話番号のお客様がいても登録する
        </label>
        <button type="submit" className="primary">
          登録
        </button>
      </form>
    </>
  );
}
