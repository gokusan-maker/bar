import { beforeEach, describe, expect, it } from "vitest";
import { fromJst } from "./domain/time";
import { MemoryRepository } from "./repo/memory";
import { MAX_ATTACHMENT_BYTES, SalesService, sniffContentType, type SaleInput } from "./sales-service";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic"), 0, 0]);

describe("SalesService", () => {
  let repo: MemoryRepository;
  let service: SalesService;

  const input = (over: Partial<SaleInput> = {}): SaleInput => ({
    businessDate: "2026-10-24",
    reservationId: null,
    customerId: null,
    staffId: null,
    channel: "manual",
    customerName: "田中",
    partySize: 2,
    drinkAmount: 6000,
    chargeAmount: 2000,
    serviceAmount: null,
    note: null,
    ...over,
  });

  beforeEach(async () => {
    repo = new MemoryRepository();
    await repo.saveSettings({ ...(await repo.getSettings()), chargePerPerson: 1500, serviceChargeRate: 15 });
    service = new SalesService(repo);
  });

  it("prefills from a reservation, including after-midnight business dates", async () => {
    const customer = await repo.findOrCreateCustomer("line", "U1", "やまだ");
    const staff = await repo.createStaff({ name: "あや", active: true, backRates: { drink: 10, charge: 0, service: 0, perVisit: 0 } });
    await repo.updateCustomer(customer.id, { staffId: staff.id });
    const r = await repo.createReservation({
      customerId: customer.id,
      channel: "line",
      startAt: fromJst("2026-10-24", "25:00").toISOString(),
      endAt: fromJst("2026-10-24", "26:00").toISOString(),
      partySize: 3,
      name: "山田",
      notes: null,
      status: "confirmed",
    });
    expect(await service.defaultsForReservation(r.id)).toMatchObject({
      businessDate: "2026-10-24",
      staffId: staff.id,
      channel: "line",
      partySize: 3,
      chargeAmount: 4500,
      serviceAmount: null,
    });
  });

  it("computes the service charge automatically unless overridden", async () => {
    const auto = await service.createSale(input());
    expect(auto).toMatchObject({ ok: true, value: { serviceAmount: 1200 } });
    const manual = await service.createSale(input({ serviceAmount: 0 }));
    expect(manual).toMatchObject({ ok: true, value: { serviceAmount: 0 } });
  });

  it("rejects invalid amounts and dates", async () => {
    expect(await service.createSale(input({ drinkAmount: -1 }))).toMatchObject({ ok: false });
    expect(await service.createSale(input({ drinkAmount: 1.5 }))).toMatchObject({ ok: false });
    expect(await service.createSale(input({ businessDate: "2026-02-30" }))).toMatchObject({ ok: false });
    expect(await service.createSale(input({ partySize: 0 }))).toMatchObject({ ok: false });
    expect(await service.createSale(input({ staffId: "missing" }))).toMatchObject({ ok: false });
  });

  it("marks the reservation visited, prevents double entry and remembers the staff", async () => {
    const customer = await repo.findOrCreateCustomer("instagram", "IG1", "ig");
    const staff = await repo.createStaff({ name: "りな", active: true, backRates: { drink: 10, charge: 0, service: 0, perVisit: 0 } });
    const r = await repo.createReservation({
      customerId: customer.id,
      channel: "instagram",
      startAt: fromJst("2026-10-24", "21:00").toISOString(),
      endAt: fromJst("2026-10-24", "23:00").toISOString(),
      partySize: 2,
      name: "ig",
      notes: null,
      status: "confirmed",
    });
    const first = await service.createSale(input({ reservationId: r.id, customerId: customer.id, staffId: staff.id, channel: "instagram" }));
    expect(first.ok).toBe(true);
    expect((await repo.getReservation(r.id))!.status).toBe("visited");
    expect((await repo.getCustomer(customer.id))!.staffId).toBe(staff.id);
    expect(await service.createSale(input({ reservationId: r.id }))).toMatchObject({ ok: false });
  });

  it("validates evidence files by content, size and count", async () => {
    const sale = await service.createSale(input());
    if (!sale.ok) throw new Error("sale failed");
    const id = sale.value.id;
    expect(await service.addEvidence(id, { name: "伝票.jpg", type: "image/jpeg", data: JPEG })).toMatchObject({
      ok: true,
      value: { contentType: "image/jpeg", fileName: "伝票.jpg" },
    });
    // 拡張子・申告タイプが画像でも中身がHTMLなら拒否
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    expect(await service.addEvidence(id, { name: "x.png", type: "image/png", data: html })).toMatchObject({ ok: false });
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    big.set(JPEG);
    expect(await service.addEvidence(id, { name: "big.jpg", type: "image/jpeg", data: big })).toMatchObject({ ok: false });
    expect(await service.addEvidence(id, { name: "../../a.pdf", type: "", data: PDF })).toMatchObject({
      ok: true,
      value: { fileName: ".._.._a.pdf", contentType: "application/pdf" },
    });
    for (let i = 0; i < 8; i++) await service.addEvidence(id, { name: `p${i}.jpg`, type: "", data: JPEG });
    expect(await service.addEvidence(id, { name: "11.jpg", type: "", data: JPEG })).toMatchObject({ ok: false });

    await repo.deleteSale(id);
    expect(await repo.listAttachments(id)).toEqual([]);
  });

  it("sniffs HEIC photos from iPhone", () => {
    expect(sniffContentType(HEIC)).toBe("image/heic");
    expect(sniffContentType(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("builds the monthly report from stored sales", async () => {
    const staff = await repo.createStaff({ name: "あや", active: true, backRates: { drink: 10, charge: 5, service: 0, perVisit: 300 } });
    await service.createSale(input({ staffId: staff.id, channel: "line" }));
    await service.createSale(input({ staffId: staff.id, channel: "line", businessDate: "2026-11-01" }));
    const report = await service.report("2026-10");
    expect(report.all.total).toBe(9200);
    expect(report.staff[0].back.total).toBe(600 + 100 + 300);
  });

  it("links a walk-in sale to an existing customer and inherits name and staff", async () => {
    const staff = await repo.createStaff({ name: "あや", active: true, backRates: { drink: 10, charge: 0, service: 0, perVisit: 0 } });
    const customer = await repo.findOrCreateCustomer("line", "U9", "やまだ");
    await repo.updateCustomer(customer.id, { name: "山田", staffId: staff.id });
    const r = await service.createSale(input({ customerId: customer.id, customerName: null, channel: "line" }));
    expect(r).toMatchObject({ ok: true, value: { customerId: customer.id, customerName: "山田", staffId: staff.id } });
    expect(await service.createSale(input({ customerId: "missing" }))).toMatchObject({ ok: false });
  });
});
