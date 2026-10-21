import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { isAdmin } from "@/lib/auth";
import { repository } from "@/lib/container";
import { summarizeCustomers } from "@/lib/domain/customers";
import { saleTotal, toCsv } from "@/lib/domain/sales";
import { toJst } from "@/lib/domain/time";
import { CHANNEL_LABEL, STATUS_LABEL } from "@/lib/domain/types";
import { businessClockOf, businessDateOf } from "@/lib/reservation-service";

const KINDS = { reservations: "予約", sales: "売上", customers: "お客様" } as const;

const stamp = (iso: string) => {
  const p = toJst(new Date(iso));
  return `${p.date} ${p.time}`;
};

/** バックアップ・Excel用のCSV書き出し（店主のみ） */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const kind = new URL(req.url).searchParams.get("kind") ?? "";
  if (!(kind in KINDS)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const repo = repository();
  const [settings, staff] = await Promise.all([repo.getSettings(), repo.listStaff()]);
  const staffName = (id: string | null) => (id ? (staff.find((s) => s.id === id)?.name ?? "") : "");

  let csv: string;
  if (kind === "reservations") {
    const list = await repo.listReservations({});
    csv = toCsv(
      ["営業日", "時刻", "お名前", "人数", "状態", "受付経路", "要望", "登録日時"],
      list.map((r) => [
        businessDateOf(r, settings), businessClockOf(r, settings), r.name, r.partySize,
        STATUS_LABEL[r.status], CHANNEL_LABEL[r.channel], r.notes, stamp(r.createdAt),
      ]),
    );
  } else if (kind === "sales") {
    const list = await repo.listSales({});
    csv = toCsv(
      ["営業日", "お客様", "人数", "経路", "担当", "お酒", "料金", "サービス料", "合計", "メモ"],
      list.map((s) => [
        s.businessDate, s.customerName, s.partySize, CHANNEL_LABEL[s.channel], staffName(s.staffId),
        s.drinkAmount, s.chargeAmount, s.serviceAmount, saleTotal(s), s.note,
      ]),
    );
  } else {
    const [customers, reservations, sales] = await Promise.all([
      repo.listCustomers({ limit: 10000 }),
      repo.listReservations({}),
      repo.listSales({}),
    ]);
    const rows = summarizeCustomers(
      customers.filter((c) => c.channel !== "simulator"),
      reservations,
      sales,
      (r) => businessDateOf(r, settings),
      new Date(),
    );
    csv = toCsv(
      ["お名前", "SNSの表示名", "経路", "担当", "来店回数", "無断キャンセル", "最終来店", "利用金額", "メモ"],
      rows.map((r) => [
        r.customer.name, r.customer.displayName, CHANNEL_LABEL[r.customer.channel], staffName(r.customer.staffId),
        r.visits, r.noShows, r.lastVisit, r.totalSpend, r.customer.note,
      ]),
    );
  }
  await recordAudit({ actor: "owner", action: `${KINDS[kind as keyof typeof KINDS]}のCSVを書き出し`, targetType: "settings", targetId: null, detail: null });
  const date = toJst(new Date()).date;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
