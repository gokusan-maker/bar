import { requireAdmin } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { repository, salesService } from "@/lib/container";
import { addDays, toJst } from "@/lib/domain/time";
import type { SaleInput } from "@/lib/sales-service";
import { SaleForm } from "../sale-form";

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ reservationId?: string; error?: string }>;
}) {
  await requireAdmin();
  const { reservationId, error } = await searchParams;
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
      channel: "manual",
      customerName: null,
      partySize: 1,
      drinkAmount: 0,
      chargeAmount: settings.chargePerPerson,
      serviceAmount: null,
      note: null,
    };
  }

  return (
    <>
      <h1>売上を登録</h1>
      {error && <p className="notice error">{error}</p>}
      <SaleForm values={values} staff={staff} settings={settings} withFiles customers={customers} />
    </>
  );
}
