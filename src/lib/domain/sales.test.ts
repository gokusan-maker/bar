import { describe, expect, it } from "vitest";
import { backForSale, csvCell, monthlyReport, monthRange, reportCsv, serviceCharge, shiftMonth } from "./sales";
import type { Sale, Staff } from "./types";

const staff = (id: string, rates: Partial<Staff["backRates"]> = {}, active = true): Staff => ({
  id,
  name: `スタッフ${id}`,
  backRates: { rate: 10, perVisit: 0, ...rates },
  active,
  passwordHash: null,
  pending: false,
  lineUserId: null,
  createdAt: "",
});

let n = 0;
const sale = (over: Partial<Sale>): Sale => ({
  id: `s${++n}`,
  businessDate: "2026-10-10",
  reservationId: null,
  customerId: null,
  staffId: "a",
  channel: "line",
  customerName: null,
  partySize: 2,
  drinkAmount: 5000,
  chargeAmount: 2000,
  serviceAmount: 700,
  note: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("sales calculations", () => {
  it("computes the service charge and rounds down", () => {
    expect(serviceCharge(5000, 2000, 10)).toBe(700);
    expect(serviceCharge(3333, 0, 15)).toBe(499);
    expect(serviceCharge(5000, 2000, 0)).toBe(0);
  });

  it("applies the back rate to the whole sale including the service charge, plus a fixed amount", () => {
    // 5000 + 2000 + 700 = 7700
    expect(backForSale(sale({}), { rate: 20, perVisit: 500 })).toEqual({ byRate: 1540, perVisit: 500, total: 2040 });
    // 999 + 2000 + 700 = 3699 × 15% = 554.85 → 円未満切り捨て
    expect(backForSale(sale({ drinkAmount: 999 }), { rate: 15, perVisit: 0 }).byRate).toBe(554);
  });

  it("aggregates a month by channel and staff, counting only SNS sales for back by default", () => {
    const sales = [
      sale({ staffId: "a" }),
      sale({ staffId: "a", channel: "instagram", drinkAmount: 10000, serviceAmount: 1200 }),
      sale({ staffId: "a", channel: "manual" }), // 電話予約: SNSではないので対象外
      sale({ staffId: "b", drinkAmount: 3000, chargeAmount: 0, serviceAmount: 300 }),
      sale({ staffId: null }), // 担当なし
      sale({ businessDate: "2026-11-01" }), // 翌月
    ];
    const report = monthlyReport("2026-10", sales, [staff("a"), staff("b", { rate: 30, perVisit: 1000 })], {
      backTarget: "sns",
    });

    expect(report.all.count).toBe(5);
    expect(report.all.total).toBe(7700 + 13200 + 7700 + 3300 + 7700);
    expect(report.sns.count).toBe(4);
    expect(report.byChannel.manual.count).toBe(1);

    const [a, b] = report.staff;
    expect(a.sales.count).toBe(2);
    expect(a.back.total).toBe(770 + 1320);
    expect(b.back).toMatchObject({ byRate: 990, perVisit: 1000, total: 1990 });
    expect(report.backTotal).toBe(4080);
  });

  it("treats simulator (test) sales as SNS", () => {
    const report = monthlyReport("2026-10", [sale({ channel: "simulator" })], [staff("a")], { backTarget: "sns" });
    expect(report.sns.count).toBe(1);
    expect(report.staff[0].back.total).toBe(770);
  });

  it("includes non-SNS sales when the target is all", () => {
    const report = monthlyReport("2026-10", [sale({ channel: "manual" })], [staff("a")], { backTarget: "all" });
    expect(report.staff[0].back.total).toBe(770);
  });

  it("hides inactive staff unless they have sales that month", () => {
    const list = [staff("a"), staff("old", {}, false), staff("left", {}, false)];
    const report = monthlyReport("2026-10", [sale({ staffId: "left" })], list, { backTarget: "sns" });
    expect(report.staff.map((r) => r.staff.id)).toEqual(["a", "left"]);
  });

  it("handles month helpers and CSV", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthRange("2028-02")).toEqual({ first: "2028-02-01", last: "2028-02-29" });
    const csv = reportCsv(monthlyReport("2026-10", [sale({})], [{ ...staff("a"), name: 'A,"愛"' }], { backTarget: "sns" }));
    expect(csv.startsWith("﻿スタッフ,")).toBe(true);
    expect(csv).toContain('"A,""愛""",10,1,2,5000,2000,700,7700,770,0,770');
  });

  it("neutralizes spreadsheet formulas from untrusted names", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+81")).toBe("'+81");
    expect(csvCell("@user")).toBe("'@user");
    expect(csvCell(-500)).toBe("-500");
    expect(csvCell(null)).toBe("");
  });
});
