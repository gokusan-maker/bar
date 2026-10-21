import {
  availabilityBoard,
  checkAvailability,
  peakOccupancy,
  suggestAlternatives,
  type AvailabilityInput,
  type Occupancy,
} from "./domain/availability";
import { templates, type ReservationSummary } from "./domain/templates";
import { addDays, DAY_MS, formatJa, fromJst, isValidDate, parseClock, toJst, weekdayJa, weekdayOf } from "./domain/time";
import {
  ACTIVE_STATUSES,
  CHANNEL_LABEL,
  canMessage,
  type AuditLog,
  type Channel,
  type Customer,
  type Draft,
  type Reservation,
  type ShopSettings,
} from "./domain/types";
import type { Extraction, Extractor } from "./extraction/schema";
import type { CalendarSync, Messenger, Notifier } from "./ports";
import type { Repository } from "./repo/types";

/** 聞き取り途中の下書き・会話履歴を有効とみなす時間 */
const CONVERSATION_TTL_MS = DAY_MS;
const HISTORY_LIMIT = 10;

export interface IncomingMessage {
  channel: Channel;
  externalId: string;
  displayName: string | null;
  text: string;
}

/** SNSのクイックリプライ（タップで送れるボタン） */
export interface QuickReply {
  label: string;
  text: string;
}

export interface ManualReservationInput {
  date: string;
  time: string;
  partySize: number;
  name: string;
  notes: string | null;
  /** 満席・営業時間外でも登録する */
  force: boolean;
}

export interface WebBookingInput {
  /** どのSNSのリンクから来たか（X用リンクなら "x"） */
  source?: "x" | "web";
  date: string;
  time: string;
  partySize: number;
  name: string;
  phone: string;
  notes: string | null;
}

export type WebBookingResult =
  | { status: "confirmed" | "pending"; reservation: Reservation }
  | { status: "invalid"; error: string }
  | { status: "unavailable"; error: string; alternatives: Date[] };

/** 日本の電話番号を数字だけにする。不正なら null */
export function normalizePhone(input: string): string | null {
  const digits = input.normalize("NFKC").replace(/[^\d+]/g, "").replace(/^\+81/, "0");
  return /^0\d{9,10}$/.test(digits) ? digits : null;
}

export type ManualResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; error: string };

interface Deps {
  repo: Repository;
  extractor: Extractor;
  calendar: CalendarSync;
  messenger: Messenger;
  notifier: Notifier;
  now?: () => Date;
}

const describe = (r: Reservation) => `${formatJa(new Date(r.startAt))} ${r.name}様 ${r.partySize}名`;

const toSummary = (r: Reservation): ReservationSummary => ({
  start: new Date(r.startAt),
  partySize: r.partySize,
  name: r.name,
});

export class ReservationService {
  private readonly repo: Repository;
  private readonly extractor: Extractor;
  private readonly calendar: CalendarSync;
  private readonly messenger: Messenger;
  private readonly notifier: Notifier;
  private readonly now: () => Date;

  constructor(deps: Deps) {
    this.repo = deps.repo;
    this.extractor = deps.extractor;
    this.calendar = deps.calendar;
    this.messenger = deps.messenger;
    this.notifier = deps.notifier;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * SNSで届いたメッセージを処理し、お客様への返信文を返す（返信の送信は呼び出し側）。
   */
  async handleIncoming(msg: IncomingMessage): Promise<string[]> {
    return (await this.handleIncomingWithQuickReplies(msg)).replies;
  }

  /**
   * handleIncoming と同じ処理をして、聞き返し中ならタップで答えられる選択肢も返す。
   */
  async handleIncomingWithQuickReplies(
    msg: IncomingMessage,
  ): Promise<{ replies: string[]; quickReplies: QuickReply[] }> {
    const { customerId, replies } = await this.process(msg);
    if (!replies.length) return { replies, quickReplies: [] };
    const draft = await this.repo.getDraft(customerId);
    return { replies, quickReplies: draft ? await this.suggestionsFor(draft) : [] };
  }

  /** 今の聞き返しに対する選択肢（テスト送信画面用） */
  async currentQuickReplies(customerId: string): Promise<QuickReply[]> {
    const draft = await this.repo.getDraft(customerId);
    return draft ? this.suggestionsFor(draft) : [];
  }

  /** 下書きでまだ決まっていない最初の項目（日付→時間→人数）の選択肢 */
  private async suggestionsFor(draft: Draft): Promise<QuickReply[]> {
    const settings = await this.repo.getSettings();
    const now = this.now();
    if (!draft.date) {
      const today = toJst(now).date;
      const options: QuickReply[] = [];
      for (let i = 0; i < 14 && options.length < 6; i++) {
        const date = addDays(today, i);
        if (settings.closedWeekdays.includes(weekdayOf(date)) || settings.closedDates.includes(date)) continue;
        if (i === 0 && !(await this.availabilityBoard(date)).some((s) => s.remaining > 0)) continue;
        const [, m, d] = date.split("-").map(Number);
        const label = i === 0 ? "今日" : i === 1 ? "明日" : `${m}/${d}(${weekdayJa(weekdayOf(date))})`;
        options.push({ label, text: `${m}/${d}` });
      }
      return options;
    }
    if (!draft.time) {
      const party = draft.partySize ?? 1;
      return (await this.availabilityBoard(draft.date))
        .filter((s) => s.remaining >= party)
        .slice(0, 6)
        .map((s) => {
          const h = Number(s.clock.slice(0, 2));
          const min = s.clock.slice(3) === "30" ? "半" : "";
          const label = h >= 24 ? `深夜${h - 24}時${min}` : `${h}時${min}`;
          return { label, text: label };
        });
    }
    if (!draft.partySize) {
      return [1, 2, 3, 4].map((n) => ({ label: `${n}名`, text: `${n}名` }));
    }
    return [];
  }

  private async process(msg: IncomingMessage): Promise<{ customerId: string; replies: string[] }> {
    const now = this.now();
    const settings = await this.repo.getSettings();
    const customer = await this.repo.findOrCreateCustomer(msg.channel, msg.externalId, msg.displayName);
    const since = new Date(now.getTime() - CONVERSATION_TTL_MS);

    if (settings.manualMode) {
      await this.repo.addMessage({ customerId: customer.id, direction: "in", text: msg.text, extraction: null });
      await this.notifier.notify(`【手動モード】${customerLabel(customer)}からメッセージ:\n${msg.text}`);
      return { customerId: customer.id, replies: [] };
    }

    let draft = await this.repo.getDraft(customer.id);
    if (draft && new Date(draft.updatedAt) < since) {
      await this.repo.deleteDraft(customer.id);
      draft = null;
    }
    const history = await this.repo.listMessages(customer.id, since, HISTORY_LIMIT);

    const extraction = await this.extractor.extract({
      text: msg.text,
      history: history.map((h) => ({ direction: h.direction, text: h.text })),
      now,
      shopType: settings.shopType,
      openTime: settings.openTime,
      closeTime: settings.closeTime,
      draft: draft && {
        date: draft.date,
        time: draft.time,
        partySize: draft.partySize,
        name: draft.name,
        notes: draft.notes,
      },
    });
    await this.repo.addMessage({ customerId: customer.id, direction: "in", text: msg.text, extraction });
    if (extraction.name && extraction.name !== customer.name) {
      await this.repo.updateCustomer(customer.id, { name: extraction.name });
      customer.name = extraction.name;
    }

    let replies: string[];
    switch (extraction.intent) {
      case "cancel":
        replies = await this.handleCancel(customer, extraction, settings, now);
        break;
      case "change":
        replies = await this.handleBooking(customer, extraction, settings, now, draft, true);
        break;
      case "new":
        replies = await this.handleBooking(customer, extraction, settings, now, draft, false);
        break;
      default:
        if (draft) {
          replies = await this.handleBooking(customer, extraction, settings, now, draft, draft.intent === "change");
        } else {
          // 予約と関係ない問い合わせは店主が対応する
          await this.notifier.notify(`${customerLabel(customer)}からのメッセージ（お店の対応が必要）:\n${msg.text}`);
          replies = [];
        }
    }

    for (const text of replies) {
      await this.repo.addMessage({ customerId: customer.id, direction: "out", text, extraction: null });
    }
    return { customerId: customer.id, replies };
  }

  /** 履歴の記録に失敗しても本来の処理は止めない */
  private async log(actor: AuditLog["actor"], action: string, r: Reservation, extra?: string) {
    try {
      await this.repo.addAudit({
        actor,
        action,
        targetType: "reservation",
        targetId: r.id,
        detail: extra ? `${describe(r)} / ${extra}` : describe(r),
      });
    } catch (error) {
      console.error("audit log failed", error);
    }
  }

  private async upcomingFor(customerId: string, now: Date): Promise<Reservation[]> {
    return (
      await this.repo.listReservations({ customerId, from: now, statuses: ACTIVE_STATUSES })
    ).filter((r) => new Date(r.startAt) > now);
  }

  /** 日付が書かれていればその営業日の予約に絞る */
  private pickTarget(upcoming: Reservation[], date: string | null, settings: ShopSettings) {
    if (upcoming.length <= 1) return upcoming;
    if (!date) return upcoming;
    const byDate = upcoming.filter((r) => businessDateOf(r, settings) === date);
    return byDate.length ? byDate : upcoming;
  }

  private async handleCancel(
    customer: Customer,
    extraction: Extraction,
    settings: ShopSettings,
    now: Date,
  ): Promise<string[]> {
    await this.repo.deleteDraft(customer.id);
    const targets = this.pickTarget(await this.upcomingFor(customer.id, now), extraction.date, settings);
    if (targets.length === 0) return [templates.cancelNotFound()];
    if (targets.length > 1) return [templates.ambiguousTarget()];

    const r = await this.repo.updateReservation(targets[0].id, { status: "cancelled" });
    await this.log("guest", "キャンセル（お客様から）", r);
    await this.safeCalendarRemove(r);
    await this.notifier.notify(`【キャンセル】${formatJa(new Date(r.startAt))} ${r.name}様 ${r.partySize}名（${customerLabel(customer)}）`);
    return [templates.cancelled(settings, toSummary(r))];
  }

  private async handleBooking(
    customer: Customer,
    extraction: Extraction,
    settings: ShopSettings,
    now: Date,
    draft: Draft | null,
    isChange: boolean,
  ): Promise<string[]> {
    let target: Reservation | null = null;
    if (isChange) {
      if (draft?.targetReservationId) {
        target = await this.repo.getReservation(draft.targetReservationId);
      } else {
        const candidates = this.pickTarget(await this.upcomingFor(customer.id, now), null, settings);
        if (candidates.length > 1) return [templates.ambiguousTarget()];
        target = candidates[0] ?? null;
      }
      // 変更対象がなければ新規予約として扱う
      if (target && !ACTIVE_STATUSES.includes(target.status)) target = null;
    }

    const fields = {
      date: extraction.date ?? (target ? businessDateOf(target, settings) : null),
      time: extraction.time ?? (target ? businessClockOf(target, settings) : null),
      partySize:
        extraction.partySize ??
        (target && extraction.partyDelta ? target.partySize + extraction.partyDelta : null) ??
        target?.partySize ??
        null,
      name: extraction.name ?? target?.name ?? customer.name ?? customer.displayName ?? "お客",
      notes: extraction.notes ?? target?.notes ?? null,
    };

    const saveDraft = (patch: Partial<Draft> = {}) =>
      this.repo.saveDraft({
        customerId: customer.id,
        intent: target ? "change" : "new",
        targetReservationId: target?.id ?? null,
        date: fields.date,
        time: fields.time,
        partySize: fields.partySize,
        name: fields.name,
        notes: fields.notes,
        updatedAt: now.toISOString(),
        ...patch,
      });

    if (extraction.partyDelta && (!target || fields.partySize === null || fields.partySize < 1)) {
      await this.notifier.notify(
        `${customerLabel(customer)}から人数の変更連絡（${extraction.partyDelta > 0 ? "+" : ""}${extraction.partyDelta}名）。自動で反映できないため確認してください。`,
      );
      return [templates.forwardedToOwner()];
    }

    const missing = (["date", "time", "partySize"] as const).filter((k) => fields[k] === null);
    if (missing.length) {
      await saveDraft();
      return [templates.askMissing([...missing])];
    }
    if (
      !isValidDate(fields.date!) ||
      parseClock(fields.time!) === null ||
      !Number.isInteger(fields.partySize) ||
      fields.partySize! < 1
    ) {
      await saveDraft({ date: null, time: null });
      return [templates.invalidDateTime()];
    }

    const start = fromJst(fields.date!, fields.time!);
    const partySize = fields.partySize!;
    const availabilityInput = await this.availabilityInput(settings, now, start, partySize, target?.id ?? null);
    const availability = checkAvailability(availabilityInput);

    const needsApproval =
      !settings.autoConfirm ||
      partySize > settings.autoConfirmMaxParty ||
      extraction.confidence === "low" ||
      /貸切|貸し切/.test(fields.notes ?? "");

    if (!availability.ok && availability.reason !== "party_too_large") {
      const alternatives =
        availability.reason === "full" || availability.reason === "blocked"
          ? suggestAlternatives(availabilityInput)
          : [];
      // 時間だけ選び直せば済む場合は、日付・人数を下書きに残す
      const keepDate = ["full", "blocked", "outside_hours"].includes(availability.reason);
      await saveDraft({ time: null, date: keepDate ? fields.date : null });
      return [templates.unavailable(settings, availability.reason, alternatives)];
    }

    const end = availability.ok
      ? availability.end
      : new Date(start.getTime() + settings.stayMinutes * 60_000);
    // 大人数（上限超え）は貸切相談として店主確認に回す
    const status = needsApproval || !availability.ok ? "pending" : "confirmed";
    const values = {
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      partySize,
      name: fields.name,
      notes: fields.notes,
      status,
    } as const;

    let reservation: Reservation;
    if (target) {
      const previous = target;
      reservation = await this.repo.updateReservation(target.id, values);
      if (availability.ok && (await this.overCapacity(reservation, settings, "any"))) {
        await this.repo.updateReservation(previous.id, {
          startAt: previous.startAt,
          endAt: previous.endAt,
          partySize: previous.partySize,
          status: previous.status,
        });
        await saveDraft({ time: null });
        return [templates.unavailable(settings, "full", [])];
      }
    } else {
      reservation = await this.repo.createReservation({
        ...values,
        customerId: customer.id,
        channel: customer.channel,
      });
      // 同時に届いた予約で席を取り合った場合、後から登録された方を取り消す
      // （上限人数超えの貸切相談は席数と関係なく店主判断なので対象外）
      if (availability.ok && (await this.overCapacity(reservation, settings, "earlier"))) {
        await this.repo.deleteReservation(reservation.id);
        await saveDraft({ time: null });
        return [templates.unavailable(settings, "full", suggestAlternatives(await this.availabilityInput(settings, now, start, partySize, null)))];
      }
    }

    await this.repo.deleteDraft(customer.id);
    await this.log(
      "guest",
      target ? "予約変更（お客様から）" : status === "pending" ? "予約受付（承認待ち）" : "予約受付（自動確定）",
      reservation,
      extraction.confidence === "low" ? "読み取りの確からしさ: 低" : undefined,
    );
    reservation = await this.syncCalendar(reservation, settings);

    const label = status === "pending" ? "【承認待ち】" : target ? "【予約変更】" : "【新規予約】";
    await this.notifier.notify(
      `${label}${formatJa(start)} ${reservation.name}様 ${partySize}名（${customerLabel(customer)}）${reservation.notes ? `\n要望: ${reservation.notes}` : ""}`,
    );

    const summary = toSummary(reservation);
    if (status === "pending") return [templates.pending(settings, summary)];
    return [target ? templates.changed(settings, summary) : templates.confirmed(settings, summary)];
  }

  private async availabilityInput(
    settings: ShopSettings,
    now: Date,
    start: Date,
    partySize: number,
    excludeId: string | null,
  ): Promise<AvailabilityInput> {
    const from = new Date(start.getTime() - DAY_MS);
    const to = new Date(start.getTime() + DAY_MS);
    const existing = await this.repo.listReservations({ from, to, statuses: ACTIVE_STATUSES });
    const occupancy: Occupancy[] = existing
      .filter((r) => r.id !== excludeId)
      .map((r) => ({ start: new Date(r.startAt), end: new Date(r.endAt), partySize: r.partySize }));
    let blocks: AvailabilityInput["blocks"] = [];
    if (settings.blockOnCalendarEvents) {
      try {
        blocks = await this.calendar.busyBlocks(from, to);
      } catch (error) {
        console.error("calendar busyBlocks failed", error);
      }
    }
    return { settings, now, start, partySize, occupancy, blocks };
  }

  /**
   * 登録後の再確認。"earlier" は自分より先に登録された予約だけと比べる
   * （同時登録でも必ずどちらか一方だけが残る）。
   */
  private async overCapacity(
    reservation: Reservation,
    settings: ShopSettings,
    mode: "earlier" | "any",
  ): Promise<boolean> {
    const start = new Date(reservation.startAt);
    const end = new Date(reservation.endAt);
    const others = (
      await this.repo.listReservations({ from: start, to: end, statuses: ACTIVE_STATUSES })
    ).filter(
      (r) =>
        r.id !== reservation.id &&
        (mode === "any" ||
          r.createdAt < reservation.createdAt ||
          (r.createdAt === reservation.createdAt && r.id < reservation.id)),
    );
    const peak = peakOccupancy(
      { start, end },
      others.map((r) => ({ start: new Date(r.startAt), end: new Date(r.endAt), partySize: r.partySize })),
    );
    return peak + reservation.partySize > settings.capacity;
  }

  private async syncCalendar(r: Reservation, settings: ShopSettings): Promise<Reservation> {
    try {
      const eventId = await this.calendar.upsert(r, settings);
      if (eventId && eventId !== r.googleEventId) {
        return await this.repo.updateReservation(r.id, { googleEventId: eventId });
      }
    } catch (error) {
      console.error("calendar upsert failed", error);
      await this.notifier.notify(`⚠ Googleカレンダーへの反映に失敗しました: ${formatJa(new Date(r.startAt))} ${r.name}様。管理画面から再同期してください。`);
    }
    return r;
  }

  private async safeCalendarRemove(r: Reservation) {
    try {
      await this.calendar.remove(r);
    } catch (error) {
      console.error("calendar remove failed", error);
      await this.notifier.notify(`⚠ Googleカレンダーから予定を削除できませんでした: ${formatJa(new Date(r.startAt))} ${r.name}様`);
    }
  }

  private async pushToCustomer(customerId: string, text: string) {
    const customer = await this.repo.getCustomer(customerId);
    if (!customer) return;
    try {
      await this.messenger.push(customer, text);
      await this.repo.addMessage({ customerId, direction: "out", text, extraction: null });
    } catch (error) {
      console.error("push message failed", error);
      await this.notifier.notify(`⚠ ${customerLabel(customer)}へのメッセージ送信に失敗しました。手動で連絡してください。\n${text}`);
    }
  }

  // ---- 店主の操作 ----

  async approve(id: string): Promise<Reservation> {
    const settings = await this.repo.getSettings();
    let r = await this.repo.updateReservation(id, { status: "confirmed" });
    await this.log("owner", "承認", r);
    r = await this.syncCalendar(r, settings);
    await this.pushToCustomer(r.customerId, templates.approved(settings, toSummary(r)));
    return r;
  }

  async reject(id: string): Promise<Reservation> {
    const settings = await this.repo.getSettings();
    const r = await this.repo.updateReservation(id, { status: "rejected" });
    await this.log("owner", "お断り", r);
    await this.safeCalendarRemove(r);
    await this.pushToCustomer(r.customerId, templates.rejected(settings, toSummary(r)));
    return r;
  }

  async cancelByShop(id: string, notifyCustomer: boolean): Promise<Reservation> {
    const settings = await this.repo.getSettings();
    const r = await this.repo.updateReservation(id, { status: "cancelled" });
    await this.log("owner", "店の都合でキャンセル", r, notifyCustomer ? "お客様に連絡" : "連絡なし");
    await this.safeCalendarRemove(r);
    if (notifyCustomer) await this.pushToCustomer(r.customerId, templates.cancelledByShop(settings, toSummary(r)));
    return r;
  }

  /** 店主が管理画面から手動で返信する */
  async sendManualReply(customerId: string, text: string): Promise<void> {
    const customer = await this.repo.getCustomer(customerId);
    if (!customer) throw new Error("customer not found");
    await this.messenger.push(customer, text);
    await this.repo.addMessage({ customerId, direction: "out", text, extraction: null });
  }

  async markVisit(id: string, visited: boolean, actor: "owner" | "staff" = "owner"): Promise<Reservation> {
    const r = await this.repo.updateReservation(id, { status: visited ? "visited" : "no_show" });
    await this.log(actor, visited ? "来店" : "無断キャンセル", r);
    return r;
  }

  async resync(id: string): Promise<Reservation> {
    const settings = await this.repo.getSettings();
    const r = await this.repo.getReservation(id);
    if (!r) throw new Error("reservation not found");
    return ACTIVE_STATUSES.includes(r.status) ? this.syncCalendar(r, settings) : r;
  }

  /** 手動登録・編集の共通チェック。force なら満席・営業時間外でも通す */
  private async checkSlot(
    input: Pick<ManualReservationInput, "date" | "time" | "partySize" | "force">,
    excludeId: string | null,
  ): Promise<{ ok: true; start: Date; end: Date } | { ok: false; error: string }> {
    const now = this.now();
    const settings = await this.repo.getSettings();
    if (!isValidDate(input.date) || parseClock(input.time) === null) {
      return { ok: false, error: "日付・時刻の形式が正しくありません" };
    }
    if (!Number.isInteger(input.partySize) || input.partySize < 1) {
      return { ok: false, error: "人数は1以上の整数で入力してください" };
    }
    const start = fromJst(input.date, input.time);
    const availability = checkAvailability(
      await this.availabilityInput(settings, now, start, input.partySize, excludeId),
    );
    if (!availability.ok && !input.force) {
      const reasons: Record<string, string> = {
        past: "過去の日時です",
        too_soon: "受付締切（直前）を過ぎています",
        too_far: "受付期間より先の日付です",
        closed_day: "休業日です",
        outside_hours: "営業時間外です",
        party_too_large: "1組の上限人数を超えています",
        blocked: "カレンダーに休業・貸切の予定があります",
        full: "満席です",
      };
      return { ok: false, error: `${reasons[availability.reason]}（「強制登録」で登録できます）` };
    }
    const end = availability.ok ? availability.end : new Date(start.getTime() + settings.stayMinutes * 60_000);
    return { ok: true, start, end };
  }

  /**
   * 予約フォーム用: 各営業日の受付できる時間（30分刻み）と残り席数。
   * 期間全体の予約とカレンダーの予定を1回ずつ読み込んで計算する。
   */
  async bookingOptions(dates: string[], stepMinutes = 30) {
    if (!dates.length) return [];
    const settings = await this.repo.getSettings();
    const now = this.now();
    const from = new Date(fromJst(dates[0], "00:00").getTime() - DAY_MS);
    const to = new Date(fromJst(dates[dates.length - 1], "00:00").getTime() + 2 * DAY_MS);
    const existing = await this.repo.listReservations({ from, to, statuses: ACTIVE_STATUSES });
    const occupancy: Occupancy[] = existing.map((r) => ({
      start: new Date(r.startAt),
      end: new Date(r.endAt),
      partySize: r.partySize,
    }));
    let blocks: AvailabilityInput["blocks"] = [];
    if (settings.blockOnCalendarEvents) {
      try {
        blocks = await this.calendar.busyBlocks(from, to);
      } catch (error) {
        console.error("calendar busyBlocks failed", error);
      }
    }
    return dates.map((date) => ({
      date,
      slots: availabilityBoard({ settings, now, occupancy, blocks }, date, stepMinutes),
    }));
  }

  /** 営業日の1時間ごとの空き状況（SNS投稿用） */
  async availabilityBoard(businessDate: string) {
    const settings = await this.repo.getSettings();
    const input = await this.availabilityInput(settings, this.now(), fromJst(businessDate, "22:00"), 1, null);
    return availabilityBoard(input, businessDate);
  }

  /** 公開の予約フォームからの申し込み */
  async handleWebBooking(input: WebBookingInput): Promise<WebBookingResult> {
    const settings = await this.repo.getSettings();
    const now = this.now();
    const name = input.name.trim().slice(0, 40);
    const phone = normalizePhone(input.phone);
    if (!name) return { status: "invalid", error: "お名前を入力してください" };
    if (!phone) return { status: "invalid", error: "電話番号を正しく入力してください" };
    if (!isValidDate(input.date) || parseClock(input.time) === null) {
      return { status: "invalid", error: "日時を選んでください" };
    }
    if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 50) {
      return { status: "invalid", error: "人数を選んでください" };
    }
    const notes = input.notes?.trim().slice(0, 300) || null;
    const start = fromJst(input.date, input.time);
    const availabilityInput = await this.availabilityInput(settings, now, start, input.partySize, null);
    const availability = checkAvailability(availabilityInput);
    if (!availability.ok && availability.reason !== "party_too_large") {
      const alternatives =
        availability.reason === "full" || availability.reason === "blocked"
          ? suggestAlternatives(availabilityInput)
          : [];
      return {
        status: "unavailable",
        error: templates.unavailable(settings, availability.reason, []).split("\n")[0],
        alternatives,
      };
    }
    const needsApproval =
      !availability.ok ||
      !settings.autoConfirm ||
      input.partySize > settings.autoConfirmMaxParty ||
      /貸切|貸し切/.test(notes ?? "");
    // 同じ電話番号のお客様は同じ人として扱う
    const channel = input.source === "x" ? "x" : "web";
    const customer = await this.repo.findOrCreateCustomer(channel, phone, name);
    if (customer.name !== name) await this.repo.updateCustomer(customer.id, { name });
    const end = availability.ok ? availability.end : new Date(start.getTime() + settings.stayMinutes * 60_000);
    let reservation = await this.repo.createReservation({
      customerId: customer.id,
      channel,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      partySize: input.partySize,
      name,
      notes: [notes, `電話: ${phone}`].filter(Boolean).join(" / "),
      status: needsApproval ? "pending" : "confirmed",
    });
    if (availability.ok && (await this.overCapacity(reservation, settings, "earlier"))) {
      await this.repo.deleteReservation(reservation.id);
      return {
        status: "unavailable",
        error: templates.unavailable(settings, "full", []).split("\n")[0],
        alternatives: suggestAlternatives(await this.availabilityInput(settings, now, start, input.partySize, null)),
      };
    }
    const via = channel === "x" ? "予約フォーム（X経由）" : "予約フォーム";
    await this.log("guest", `${via}から受付（${needsApproval ? "承認待ち" : "自動確定"}）`, reservation);
    reservation = await this.syncCalendar(reservation, settings);
    await this.notifier.notify(
      `${needsApproval ? "【承認待ち】" : "【新規予約】"}${describe(reservation)}（${via}・電話 ${phone}）${notes ? `\n要望: ${notes}` : ""}`,
    );
    return { status: needsApproval ? "pending" : "confirmed", reservation };
  }

  /** 電話・来店で受けた予約を店主が登録する */
  async createManual(input: ManualReservationInput): Promise<ManualResult> {
    const slot = await this.checkSlot(input, null);
    if (!slot.ok) return slot;
    const settings = await this.repo.getSettings();
    const customer = await this.repo.findOrCreateCustomer("manual", null, input.name);
    let reservation = await this.repo.createReservation({
      customerId: customer.id,
      channel: "manual",
      startAt: slot.start.toISOString(),
      endAt: slot.end.toISOString(),
      partySize: input.partySize,
      name: input.name,
      notes: input.notes,
      status: "confirmed",
    });
    await this.log("owner", "手動登録", reservation, input.force ? "強制登録" : undefined);
    reservation = await this.syncCalendar(reservation, settings);
    return { ok: true, reservation };
  }

  /** 店主が予約の日時・人数・名前・要望を直す */
  async editByShop(
    id: string,
    input: ManualReservationInput & { notifyCustomer: boolean },
  ): Promise<ManualResult> {
    const current = await this.repo.getReservation(id);
    if (!current) return { ok: false, error: "予約が見つかりません" };
    if (!ACTIVE_STATUSES.includes(current.status)) {
      return { ok: false, error: "承認待ち・確定の予約だけ編集できます" };
    }
    const slot = await this.checkSlot(input, id);
    if (!slot.ok) return slot;
    const settings = await this.repo.getSettings();
    const timeChanged = slot.start.toISOString() !== current.startAt;
    let r = await this.repo.updateReservation(id, {
      startAt: slot.start.toISOString(),
      endAt: slot.end.toISOString(),
      partySize: input.partySize,
      name: input.name,
      notes: input.notes,
      // 日時が変わったらリマインドを送り直す
      ...(timeChanged ? { reminderSentAt: null } : {}),
    });
    await this.log("owner", "編集", r, `変更前: ${describe(current)}`);
    r = await this.syncCalendar(r, settings);
    const visibleChange = timeChanged || r.partySize !== current.partySize;
    if (input.notifyCustomer && visibleChange && canMessage(r.channel)) {
      await this.pushToCustomer(r.customerId, templates.changed(settings, toSummary(r)));
    }
    return { ok: true, reservation: r };
  }

  /** カレンダーに反映できていない予約を再同期する（cron用）。成功件数を返す */
  async retryCalendarSync(): Promise<number> {
    const now = this.now();
    const settings = await this.repo.getSettings();
    const targets = (
      await this.repo.listReservations({ from: now, statuses: ACTIVE_STATUSES })
    ).filter((r) => !r.googleEventId);
    let synced = 0;
    let failed = 0;
    for (const r of targets) {
      try {
        // カレンダー連携がない場合 upsert は null を返す
        const eventId = await this.calendar.upsert(r, settings);
        if (eventId) {
          await this.repo.updateReservation(r.id, { googleEventId: eventId });
          await this.log("system", "カレンダー再同期", r);
          synced++;
        }
      } catch (error) {
        console.error("calendar retry failed", error);
        failed++;
      }
    }
    if (failed > 0) {
      await this.notifier.notify(`⚠ Googleカレンダーに反映できていない予約が${failed}件あります。連携状態を確認してください。`);
    }
    return synced;
  }

  /**
   * Googleカレンダー側で予約の予定が動かされた・削除されたら、アプリに反映する（cron・手動）。
   * お客様への連絡は自動では行わず、店主に通知する。
   */
  async pullCalendarChanges(): Promise<{ moved: number; deleted: number; failed: number }> {
    const now = this.now();
    const targets = (
      await this.repo.listReservations({ from: now, statuses: ACTIVE_STATUSES })
    ).filter((r) => r.googleEventId);
    let moved = 0;
    let deleted = 0;
    let failed = 0;
    for (const r of targets) {
      let ev: Awaited<ReturnType<CalendarSync["getEvent"]>>;
      try {
        ev = await this.calendar.getEvent(r.googleEventId!);
      } catch (error) {
        console.error("calendar getEvent failed", error);
        failed++;
        continue;
      }
      if (ev === null) continue;
      if (ev === "deleted") {
        const updated = await this.repo.updateReservation(r.id, { status: "cancelled", googleEventId: null });
        await this.log("owner", "キャンセル（Googleカレンダーで削除）", updated);
        await this.notifier.notify(
          `【カレンダーで削除】${describe(r)} の予定が削除されたため、予約をキャンセルにしました。お客様への連絡が必要なら管理画面から行ってください。`,
        );
        deleted++;
        continue;
      }
      if (ev.start.toISOString() === r.startAt && ev.end.toISOString() === r.endAt) continue;
      const updated = await this.repo.updateReservation(r.id, {
        startAt: ev.start.toISOString(),
        endAt: ev.end.toISOString(),
        ...(ev.start.toISOString() !== r.startAt ? { reminderSentAt: null } : {}),
      });
      await this.log("owner", "時間変更（Googleカレンダーで移動）", updated, `変更前: ${describe(r)}`);
      await this.notifier.notify(
        `【カレンダーで移動】${describe(r)} → ${formatJa(ev.start)} に変更しました。お客様への連絡が必要なら管理画面から行ってください。`,
      );
      moved++;
    }
    return { moved, deleted, failed };
  }

  /** 開店前に今夜の予約一覧を店主に送る（cron用） */
  async sendDailyDigest(): Promise<string | null> {
    const now = this.now();
    const settings = await this.repo.getSettings();
    const today = toJst(now).date;
    const list = (
      await this.repo.listReservations({
        from: fromJst(today, "06:00"),
        to: fromJst(today, "30:00"),
        statuses: ACTIVE_STATUSES,
      })
    ).filter((r) => r.startAt >= fromJst(today, "06:00").toISOString());
    const [, m, d] = today.split("-").map(Number);
    const guests = list.reduce((n, r) => n + r.partySize, 0);
    const pending = list.filter((r) => r.status === "pending").length;
    const lines = list.map(
      (r) =>
        `${toJst(new Date(r.startAt)).time} ${r.name}様 ${r.partySize}名${r.status === "pending" ? "（承認待ち）" : ""}${r.notes ? ` / ${r.notes}` : ""}`,
    );
    const text = list.length
      ? `【本日の予約 ${m}/${d}】${list.length}組 ${guests}名${pending ? `（承認待ち${pending}件）` : ""}\n${lines.join("\n")}`
      : `【本日の予約 ${m}/${d}】予約はありません`;
    if (settings.closedWeekdays.includes(toJst(now).weekday) || settings.closedDates.includes(today)) {
      return null;
    }
    await this.notifier.notify(text);
    return text;
  }

  /** 保存期間を過ぎた個人情報を削除・匿名化する（cron用） */
  async purgeExpiredPersonalData() {
    const settings = await this.repo.getSettings();
    if (!settings.retentionMonths) return null;
    const cutoff = new Date(this.now());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - settings.retentionMonths);
    const result = await this.repo.purgePersonalData(cutoff);
    const total = result.messages + result.reservations + result.sales + result.customers;
    if (total > 0) {
      try {
        await this.repo.addAudit({
          actor: "system",
          action: "保存期間を過ぎた個人情報を削除",
          targetType: "customer",
          targetId: null,
          detail: `メッセージ${result.messages}件・予約${result.reservations}件・売上${result.sales}件・お客様${result.customers}人`,
        });
      } catch (error) {
        console.error("audit log failed", error);
      }
    }
    return result;
  }

  /** 翌営業日の予約へのリマインド。毎日1回（日中に）cronから呼ばれる想定 */
  async sendReminders(): Promise<number> {
    const now = this.now();
    const settings = await this.repo.getSettings();
    if (!settings.sendReminders) return 0;
    // 翌日の朝6時〜翌々日の朝6時 = 翌日の夜の営業（深夜帯を含む）
    const tomorrow = toJst(new Date(now.getTime() + DAY_MS)).date;
    const from = fromJst(tomorrow, "06:00");
    const to = fromJst(tomorrow, "30:00");
    const targets = (await this.repo.listReservations({ from, to, statuses: ["confirmed"] })).filter(
      (r) => !r.reminderSentAt && r.startAt >= from.toISOString() && r.startAt < to.toISOString(),
    );
    let sent = 0;
    for (const r of targets) {
      const customer = await this.repo.getCustomer(r.customerId);
      // 電話・予約フォームのお客様にはアプリから送れない
      if (!customer?.externalId || !canMessage(customer.channel)) continue;
      await this.pushToCustomer(r.customerId, templates.reminder(settings, toSummary(r)));
      await this.repo.updateReservation(r.id, { reminderSentAt: now.toISOString() });
      await this.log("system", "リマインド送信", r);
      sent++;
    }
    return sent;
  }
}

function customerLabel(c: Customer): string {
  const channel = CHANNEL_LABEL[c.channel];
  return `${channel}: ${c.displayName ?? c.name ?? "名前未設定"}`;
}

/** 予約の営業日（深夜帯は前日） */
export function businessDateOf(r: Reservation, settings: ShopSettings): string {
  return businessParts(r, settings).date;
}

export function businessClockOf(r: Reservation, settings: ShopSettings): string {
  return businessParts(r, settings).clock;
}

function businessParts(r: Reservation, settings: ShopSettings) {
  const p = toJst(new Date(r.startAt));
  const open = parseClock(settings.openTime) ?? 0;
  const minutes = parseClock(p.time)!;
  // 開店時刻より前（深夜帯）なら前日の営業日の24時以降として表す
  if (minutes < open && minutes < 12 * 60) {
    const prev = toJst(new Date(fromJst(p.date, "00:00").getTime() - DAY_MS)).date;
    const h = Math.floor(minutes / 60) + 24;
    return { date: prev, clock: `${h}:${String(minutes % 60).padStart(2, "0")}` };
  }
  return { date: p.date, clock: p.time };
}
