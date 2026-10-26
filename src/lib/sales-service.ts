import { monthlyReport, monthRange, serviceCharge, type MonthlyReport } from "./domain/sales";
import { isValidDate } from "./domain/time";
import type { Attachment, BackRates, Channel, Sale } from "./domain/types";
import type { Repository } from "./repo/types";
import { businessDateOf } from "./reservation-service";

/** スマホの写真を縮小した後に十分収まる上限（一度に送れる量は next.config の bodySizeLimit） */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_SALE = 10;

export interface SaleInput {
  businessDate: string;
  reservationId: string | null;
  customerId: string | null;
  staffId: string | null;
  channel: Channel;
  customerName: string | null;
  partySize: number;
  drinkAmount: number;
  chargeAmount: number;
  /** null ならサービス料率から自動計算 */
  serviceAmount: number | null;
  note: string | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface EvidenceFile {
  name: string;
  type: string;
  data: Uint8Array;
}

/** ファイル先頭のバイトで形式を判定する（ブラウザ申告のContent-Typeは信用しない） */
export function sniffContentType(data: Uint8Array): string | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => data[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  // HEIC/HEIF: "ftyp" + brand
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...data.slice(8, 12));
    if (["heic", "heix", "mif1", "msf1", "heim", "heis"].includes(brand)) return "image/heic";
  }
  return null;
}

const isAmount = (n: number) => Number.isInteger(n) && n >= 0 && n <= 100_000_000;

export class SalesService {
  constructor(private readonly repo: Repository) {}

  /** 予約から売上入力フォームの初期値を作る */
  async defaultsForReservation(reservationId: string): Promise<SaleInput | null> {
    const r = await this.repo.getReservation(reservationId);
    if (!r) return null;
    const [settings, customer] = await Promise.all([
      this.repo.getSettings(),
      this.repo.getCustomer(r.customerId),
    ]);
    return {
      businessDate: businessDateOf(r, settings),
      reservationId: r.id,
      customerId: r.customerId,
      staffId: customer?.staffId ?? null,
      channel: r.channel,
      customerName: r.name,
      partySize: r.partySize,
      drinkAmount: 0,
      chargeAmount: settings.chargePerPerson * r.partySize,
      serviceAmount: null,
      note: null,
    };
  }

  private async validate(input: SaleInput): Promise<Result<Omit<Sale, "id" | "createdAt" | "updatedAt">>> {
    if (!isValidDate(input.businessDate)) return { ok: false, error: "営業日を正しく入力してください" };
    if (!Number.isInteger(input.partySize) || input.partySize < 1) {
      return { ok: false, error: "人数は1以上の整数で入力してください" };
    }
    const amounts = [input.drinkAmount, input.chargeAmount, input.serviceAmount ?? 0];
    if (!amounts.every(isAmount)) return { ok: false, error: "金額は0以上の整数（円）で入力してください" };
    if (input.staffId && !(await this.repo.getStaff(input.staffId))) {
      return { ok: false, error: "担当スタッフが見つかりません" };
    }
    const settings = await this.repo.getSettings();
    return {
      ok: true,
      value: {
        ...input,
        serviceAmount:
          input.serviceAmount ?? serviceCharge(input.drinkAmount, input.chargeAmount, settings.serviceChargeRate),
      },
    };
  }

  async createSale(input: SaleInput): Promise<Result<Sale>> {
    if (input.customerId && !input.reservationId) {
      // 予約なしでも既存のお客様を選んだら、名前と担当スタッフを引き継ぐ
      const customer = await this.repo.getCustomer(input.customerId);
      if (!customer) return { ok: false, error: "お客様が見つかりません" };
      input = {
        ...input,
        customerName: input.customerName ?? customer.name ?? customer.displayName,
        staffId: input.staffId ?? customer.staffId,
      };
    }
    const v = await this.validate(input);
    if (!v.ok) return v;
    if (input.reservationId) {
      // 1つの予約に売上を二重登録しない
      const existing = await this.repo.listSales({ reservationId: input.reservationId });
      if (existing.length) return { ok: false, error: "この予約の売上はすでに登録されています" };
      const r = await this.repo.getReservation(input.reservationId);
      if (r && r.status !== "visited") await this.repo.updateReservation(r.id, { status: "visited" });
    }
    const sale = await this.repo.createSale(v.value);
    // 担当が決まったら次回以降の初期値にする
    if (sale.customerId && sale.staffId) {
      const customer = await this.repo.getCustomer(sale.customerId);
      if (customer && !customer.staffId) await this.repo.updateCustomer(customer.id, { staffId: sale.staffId });
    }
    return { ok: true, value: sale };
  }

  async updateSale(id: string, input: SaleInput): Promise<Result<Sale>> {
    const current = await this.repo.getSale(id);
    if (!current) return { ok: false, error: "売上が見つかりません" };
    const v = await this.validate({ ...input, reservationId: current.reservationId, customerId: current.customerId });
    if (!v.ok) return v;
    return { ok: true, value: await this.repo.updateSale(id, v.value) };
  }

  async addEvidence(saleId: string, file: EvidenceFile): Promise<Result<Attachment>> {
    if (!(await this.repo.getSale(saleId))) return { ok: false, error: "売上が見つかりません" };
    if (file.data.byteLength === 0) return { ok: false, error: "ファイルが空です" };
    if (file.data.byteLength > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: "ファイルが大きすぎます（4MBまで）" };
    }
    const contentType = sniffContentType(file.data);
    if (!contentType) return { ok: false, error: "画像（JPEG・PNG・HEIC・WebP・GIF）かPDFを添付してください" };
    if ((await this.repo.listAttachments(saleId)).length >= MAX_ATTACHMENTS_PER_SALE) {
      return { ok: false, error: `添付は1件の売上につき${MAX_ATTACHMENTS_PER_SALE}個までです` };
    }
    const fileName = file.name.replace(/[\\/\0]/g, "_").slice(0, 120) || "evidence";
    const meta = await this.repo.addAttachment(
      { saleId, fileName, contentType, size: file.data.byteLength },
      file.data,
    );
    return { ok: true, value: meta };
  }

  async report(month: string): Promise<MonthlyReport> {
    const { first, last } = monthRange(month);
    const [sales, staff, settings] = await Promise.all([
      this.repo.listSales({ fromDate: first, toDate: last }),
      this.repo.listStaff(),
      this.repo.getSettings(),
    ]);
    return monthlyReport(month, sales, staff, settings);
  }
}

export function validateBackRates(rates: BackRates): string | null {
  if (!Number.isFinite(rates.rate) || rates.rate < 0 || rates.rate > 100) return "バック率は0〜100%で入力してください";
  if (!Number.isInteger(rates.perVisit) || rates.perVisit < 0) return "固定バックは0以上の整数（円）で入力してください";
  return null;
}

