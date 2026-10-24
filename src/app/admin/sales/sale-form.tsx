import type { Channel, Customer, ShopSettings, Staff } from "@/lib/domain/types";
import type { SaleInput } from "@/lib/sales-service";
import { EvidenceInput } from "../evidence-input";
import { saveSaleAction } from "../sales-actions";
import { CHANNEL_LABEL } from "../ui";

/** 売上の入力フォーム（新規・編集共通） */
export function SaleForm({
  id,
  values,
  staff,
  settings,
  withFiles,
  customers = [],
  orderIds = [],
}: {
  /** 売上に取り込む注文（QRコード注文の会計） */
  orderIds?: string[];
  /** 予約なしの新規登録で選べる既存のお客様 */
  customers?: Customer[];
  id?: string;
  values: SaleInput;
  staff: Staff[];
  settings: ShopSettings;
  withFiles: boolean;
}) {
  const fromReservation = !!values.reservationId;
  const selectable = staff.filter((s) => s.active || s.id === values.staffId);
  return (
    <form action={saveSaleAction} className="card">
      {id && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="reservationId" value={values.reservationId ?? ""} />
      {orderIds.length > 0 && <input type="hidden" name="orderIds" value={orderIds.join(",")} />}
      {customers.length > 0 && !id && !fromReservation ? (
        <label>
          既存のお客様（選ぶと来店履歴に記録され、担当スタッフも引き継ぎます）
          <select name="customerId" defaultValue={values.customerId ?? ""}>
            <option value="">選ばない（新しいお客様・一見さん）</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.displayName}（{CHANNEL_LABEL[c.channel]}）
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="customerId" value={values.customerId ?? ""} />
      )}
      <div className="grid2">
        <label>
          営業日
          <input type="date" name="businessDate" required defaultValue={values.businessDate} />
        </label>
        <label>
          お客様
          <input name="customerName" defaultValue={values.customerName ?? ""} />
        </label>
        <label>
          人数
          <input type="number" name="partySize" min={1} required defaultValue={values.partySize} />
        </label>
        <label>
          集客経路
          {fromReservation ? (
            <>
              <input type="hidden" name="channel" value={values.channel} />
              <input value={CHANNEL_LABEL[values.channel]} disabled />
            </>
          ) : (
            <select name="channel" defaultValue={values.channel}>
              {(["line", "instagram", "x", "web", "manual"] as Channel[]).map((c) => (
                <option key={c} value={c}>
                  {c === "manual" ? "SNS以外（電話・来店・紹介）" : CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          )}
        </label>
        <label>
          担当スタッフ（バック先）
          <select name="staffId" defaultValue={values.staffId ?? ""}>
            <option value="">なし</option>
            {selectable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid2">
        <label>
          お酒・ドリンク（円）
          <input name="drinkAmount" inputMode="numeric" defaultValue={values.drinkAmount} />
        </label>
        <label>
          料金（チャージ・セット）（円）
          <input name="chargeAmount" inputMode="numeric" defaultValue={values.chargeAmount} />
          <span className="muted">1人あたり {settings.chargePerPerson.toLocaleString("ja-JP")}円</span>
        </label>
        <label>
          サービス料（円）
          <input name="serviceAmount" inputMode="numeric" defaultValue={values.serviceAmount ?? ""} />
        </label>
      </div>
      <label>
        <input type="checkbox" name="serviceAuto" defaultChecked={values.serviceAmount === null} />
        サービス料を自動計算する（（お酒＋料金）× {settings.serviceChargeRate}%）
      </label>
      <label>
        メモ
        <textarea name="note" rows={2} defaultValue={values.note ?? ""} />
      </label>
      {withFiles && <EvidenceInput />}
      <button type="submit" className="primary">
        {id ? "売上を更新" : "売上を登録"}
      </button>
    </form>
  );
}
