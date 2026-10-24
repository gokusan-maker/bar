import type { BackRates, Channel, Sale, ShopSettings, Staff } from "./types";

/**
 * SNS経由とみなす経路。予約フォームはSNSのプロフィールから開かれるのでSNS扱い、
 * テスト送信（simulator）もSNSの代わりなのでSNS扱いにする
 */
export const SNS_CHANNELS: readonly Channel[] = ["line", "instagram", "x", "web", "simulator"];

export const isSnsChannel = (c: Channel) => SNS_CHANNELS.includes(c);

/** サービス料 = (ドリンク + 料金) × 率。円未満は切り捨て */
export function serviceCharge(drinkAmount: number, chargeAmount: number, ratePercent: number): number {
  return Math.floor(((drinkAmount + chargeAmount) * ratePercent) / 100);
}

export const saleTotal = (s: Pick<Sale, "drinkAmount" | "chargeAmount" | "serviceAmount">) =>
  s.drinkAmount + s.chargeAmount + s.serviceAmount;

export interface BackBreakdown {
  /** 売上全体 × バック率（円未満切り捨て） */
  byRate: number;
  perVisit: number;
  total: number;
}

/** 1会計分のバック。サービス料も含めた売上全体にバック率をかける */
export function backForSale(sale: Sale, rates: BackRates): BackBreakdown {
  const byRate = Math.floor((saleTotal(sale) * rates.rate) / 100);
  return { byRate, perVisit: rates.perVisit, total: byRate + rates.perVisit };
}

export function isBackTarget(sale: Sale, settings: Pick<ShopSettings, "backTarget">): boolean {
  return sale.staffId !== null && (settings.backTarget === "all" || isSnsChannel(sale.channel));
}

export interface AmountTotals {
  count: number;
  guests: number;
  drink: number;
  charge: number;
  service: number;
  total: number;
}

const emptyTotals = (): AmountTotals => ({ count: 0, guests: 0, drink: 0, charge: 0, service: 0, total: 0 });

function addSale(t: AmountTotals, s: Sale) {
  t.count += 1;
  t.guests += s.partySize;
  t.drink += s.drinkAmount;
  t.charge += s.chargeAmount;
  t.service += s.serviceAmount;
  t.total += saleTotal(s);
}

export interface StaffBackRow {
  staff: Staff;
  /** バック対象の売上 */
  sales: AmountTotals;
  back: BackBreakdown;
}

export interface MonthlyReport {
  month: string;
  all: AmountTotals;
  sns: AmountTotals;
  byChannel: Record<Channel, AmountTotals>;
  staff: StaffBackRow[];
  backTotal: number;
}

/** 月の売上とスタッフ別バックを集計する。sales はその月の営業日のもの */
export function monthlyReport(
  month: string,
  sales: Sale[],
  staffList: Staff[],
  settings: Pick<ShopSettings, "backTarget">,
): MonthlyReport {
  const inMonth = sales.filter((s) => s.businessDate.startsWith(`${month}-`));
  const all = emptyTotals();
  const sns = emptyTotals();
  const byChannel = {
    line: emptyTotals(),
    instagram: emptyTotals(),
    x: emptyTotals(),
    web: emptyTotals(),
    simulator: emptyTotals(),
    manual: emptyTotals(),
  };
  const rows = new Map<string, StaffBackRow>(
    staffList.map((staff) => [
      staff.id,
      { staff, sales: emptyTotals(), back: { byRate: 0, perVisit: 0, total: 0 } },
    ]),
  );

  for (const s of inMonth) {
    addSale(all, s);
    addSale(byChannel[s.channel], s);
    if (isSnsChannel(s.channel)) addSale(sns, s);
    const row = s.staffId ? rows.get(s.staffId) : undefined;
    if (!row || !isBackTarget(s, settings)) continue;
    addSale(row.sales, s);
    const b = backForSale(s, row.staff.backRates);
    row.back.byRate += b.byRate;
    row.back.perVisit += b.perVisit;
    row.back.total += b.total;
  }

  // 退職などで無効にしたスタッフも、その月に対象売上があれば表示する
  const staff = [...rows.values()].filter((r) => r.staff.active || r.sales.count > 0);
  return {
    month,
    all,
    sns,
    byChannel,
    staff,
    backTotal: staff.reduce((n, r) => n + r.back.total, 0),
  };
}

/** "YYYY-MM" の前後の月 */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

/** CSVの1セル。数式として実行されないよう、= + - @ で始まる文字列の先頭に ' を付ける */
export const csvCell = (v: string | number | null) => {
  if (v === null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Excelで開けるBOM付きCSV */
export const toCsv = (header: string[], rows: (string | number | null)[][]) =>
  "\uFEFF" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** 給与計算用のCSV（Excelで開けるようBOM付き） */
export function reportCsv(report: MonthlyReport): string {
  const header = [
    "スタッフ", "バック率(%)", "組数", "人数", "ドリンク売上", "料金売上", "サービス料売上", "対象売上合計",
    "率によるバック", "固定バック", "バック合計",
  ];
  return toCsv(
    header,
    report.staff.map((r) => [
      r.staff.name, r.staff.backRates.rate, r.sales.count, r.sales.guests, r.sales.drink, r.sales.charge, r.sales.service,
      r.sales.total, r.back.byRate, r.back.perVisit, r.back.total,
    ]),
  );
}
