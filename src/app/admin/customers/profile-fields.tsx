import { birthdayLabel, phoneLabel } from "@/lib/domain/customers";
import type { Customer } from "@/lib/domain/types";

/** お客様の名前・電話・誕生日・タグ・メモの入力欄（新規登録・編集共通） */
export function ProfileFields({ customer }: { customer?: Customer }) {
  return (
    <>
      <div className="grid2">
        <label>
          お名前
          <input name="name" maxLength={40} defaultValue={customer?.name ?? customer?.displayName ?? ""} required={!customer} />
        </label>
        <label>
          電話番号
          <input name="phone" type="tel" inputMode="tel" placeholder="090-1234-5678" defaultValue={customer?.phone ? phoneLabel(customer.phone) : ""} />
        </label>
        <label>
          誕生日（月/日）
          <input name="birthday" placeholder="5/3" defaultValue={customer?.birthday ? birthdayLabel(customer.birthday).replace("月", "/").replace("日", "") : ""} />
        </label>
        <label>
          タグ（「、」区切り。例: 常連、VIP、ワイン好き）
          <input name="tags" defaultValue={customer?.tags.join("、") ?? ""} />
        </label>
      </div>
      <label>
        顧客メモ（好きなお酒、NG事項など）
        <textarea name="note" rows={2} maxLength={1000} defaultValue={customer?.note ?? ""} />
      </label>
    </>
  );
}
