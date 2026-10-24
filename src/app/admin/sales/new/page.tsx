import { requireStaff } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { repository, salesService } from "@/lib/container";
import { addDays, toJst } from "@/lib/domain/time";
import { summarizeForSale } from "@/lib/order-service";
import type { SaleInput } from "@/lib/sales-service";
import { SaleForm } from "../sale-form";

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ reservationId?: string; error?: string; orders?: string }>;
}) {
  await requireStaff();
  const { reservationId, error, orders: orderParam } = await searchParams;
  const repo = repository();
  const [settings, staff, allCustomers] = await Promise.all([
    repo.getSettings(),
    repo.listStaff(),
    repo.listCustomers({ limit: 300 }),
  ]);
  // テスト送信のお客様と、名前の分からないお客様は選択肢に出さない
  const customers = allCustomers
    .filter((c) => c.channel !== "simulator" && (c.name || c.displayName))
    .sort((a, b) => (a.name ?? a.displayName ?? "").localeCompare(b.name ?? b.displayName ?? "", "ja"));

  let values: SaleInput;
  if (reservationId) {
    const existing = await repo.listSales({ reservationId });
    if (existing.length) redirect(`/admin/sales/${existing[0].id}`);
    const defaults = await salesService().defaultsForReservation(reservationId);
    if (!defaults) notFound();
    values = defaults;
  } else {
    // 朝6時までは前日の営業日
    const now = toJst(new Date());
    values = {
      businessDate: now.time < "06:00" ? addDays(now.date, -1) : now.date,
      reservationId: null,
      customerId: null,
      staffId: null,
      // いちばん多い経路を最初から選んでおく
      channel: "line",
      customerName: null,
      partySize: 1,
      drinkAmount: 0,
      chargeAmount: settings.chargePerPerson,
      serviceAmount: null,
      note: null,
    };
  }

  // 注文画面の「会計」から来た場合は、その席の注文をお酒の金額に入れる
  const orders = orderParam
    ? (await Promise.all(orderParam.split(",").slice(0, 100).map((id) => repo.getOrder(id)))).filter(
        (o) => o !== null && o.status !== "cancelled" && !o.saleId,
      )
    : [];
  if (orders.length) {
    const { total, note } = summarizeForSale(orders.map((o) => o!));
    values = { ...values, drinkAmount: total, note: `注文: ${note}` };
  }

  return (
    <>
      <h1>売上を登録</h1>
      {error && <p className="notice error">{error}</p>}
      {orders.length > 0 && (
        <p className="notice">
          {orders[0]!.tableName}の注文 {orders.length}件をお酒の金額に入れました。人数・料金・担当を確認して登録してください。
        </p>
      )}
      <SaleForm
        values={values}
        staff={staff}
        settings={settings}
        withFiles
        customers={customers}
        orderIds={orders.map((o) => o!.id)}
      />
    </>
  );
}
