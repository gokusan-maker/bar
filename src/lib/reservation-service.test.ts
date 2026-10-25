import { beforeEach, describe, expect, it } from "vitest";
import { fromJst } from "./domain/time";
import type { Customer, Reservation } from "./domain/types";
import { RuleBasedExtractor } from "./extraction/rule-based";
import type { Extraction, Extractor } from "./extraction/schema";
import type { CalendarSync } from "./ports";
import { MemoryRepository } from "./repo/memory";
import { normalizePhone, ReservationService } from "./reservation-service";

class FakeCalendar implements CalendarSync {
  events = new Map<string, Reservation>();
  async upsert(r: Reservation) {
    const id = r.googleEventId ?? `evt-${r.id}`;
    this.events.set(id, r);
    return id;
  }
  async remove(r: Reservation) {
    if (r.googleEventId) this.events.delete(r.googleEventId);
  }
  async busyBlocks() {
    return [];
  }
  /** テストからカレンダー側の変更を再現する */
  remote = new Map<string, { start: Date; end: Date } | "deleted">();
  async getEvent(id: string) {
    return this.remote.get(id) ?? (this.events.has(id) ? { start: new Date(this.events.get(id)!.startAt), end: new Date(this.events.get(id)!.endAt) } : "deleted" as const);
  }
}

describe("ReservationService", () => {
  let repo: MemoryRepository;
  let calendar: FakeCalendar;
  let pushed: { customer: Customer; text: string }[];
  let notices: string[];
  let now: Date;
  let extractor: Extractor;

  const make = () =>
    new ReservationService({
      repo,
      extractor,
      calendar,
      messenger: { push: async (customer, text) => void pushed.push({ customer, text }) },
      notifier: { notify: async (t) => void notices.push(t) },
      now: () => now,
    });

  const send = (text: string, externalId = "U1") =>
    make().handleIncoming({ channel: "line", externalId, displayName: "やまだ", text });

  beforeEach(async () => {
    repo = new MemoryRepository();
    await repo.saveSettings({ ...(await repo.getSettings()), shopName: "Bar Test", capacity: 6 });
    calendar = new FakeCalendar();
    pushed = [];
    notices = [];
    now = fromJst("2026-10-20", "15:00");
    extractor = new RuleBasedExtractor();
  });

  it("auto-confirms a complete request and syncs the calendar", async () => {
    const [reply] = await send("10/25 21時から2名でお願いします。山田です");
    expect(reply).toContain("承りました");
    expect(reply).toContain("10/25(日) 21:00");
    expect(reply).toContain("山田様");

    const [r] = await repo.listReservations({});
    expect(r).toMatchObject({ status: "confirmed", partySize: 2, name: "山田", channel: "line" });
    expect(r.startAt).toBe(fromJst("2026-10-25", "21:00").toISOString());
    expect(r.googleEventId).toBe(`evt-${r.id}`);
    expect(calendar.events.size).toBe(1);
    expect(notices[0]).toContain("【新規予約】");
  });

  it("asks for missing items and completes over several messages", async () => {
    const [ask] = await send("土曜に予約したいです");
    expect(ask).toContain("お時間・人数");
    expect(await repo.listReservations({})).toHaveLength(0);

    const [ask2] = await send("9時で");
    expect(ask2).toContain("人数");

    const [done] = await send("3人です");
    expect(done).toContain("承りました");
    const [r] = await repo.listReservations({});
    expect(r.startAt).toBe(fromJst("2026-10-24", "21:00").toISOString());
    // 名前を名乗らなければLINEの表示名を使う
    expect(r.name).toBe("やまだ");
  });

  it("puts large parties on hold for the owner", async () => {
    const [reply] = await send("10/25 21時 5名");
    expect(reply).toContain("店主が確認");
    const [r] = await repo.listReservations({});
    expect(r.status).toBe("pending");
    expect(notices[0]).toContain("【承認待ち】");

    await make().approve(r.id);
    expect((await repo.getReservation(r.id))!.status).toBe("confirmed");
    expect(pushed[0].text).toContain("確定しました");
  });

  it("puts low-confidence extractions on hold", async () => {
    extractor = {
      async extract(): Promise<Extraction> {
        return { intent: "new", date: "2026-10-25", time: "21:00", partySize: 2, partyDelta: null, name: null, notes: null, confidence: "low" };
      },
    };
    await send("たぶん土曜の夜に2人で");
    expect((await repo.listReservations({}))[0].status).toBe("pending");
  });

  it("offers alternatives when full and lets the guest pick a new time", async () => {
    await send("10/25 21時 4名", "U-other");
    const [full] = await send("10/25 21時 4名");
    expect(full).toContain("満席");
    expect(full).toContain("23:00");

    const [ok] = await send("23時でお願いします");
    expect(ok).toContain("承りました");
    expect(ok).toContain("10/25(日) 23:00");
    expect(await repo.listReservations({ statuses: ["confirmed"] })).toHaveLength(2);
  });

  it("rejects closed days and times outside business hours", async () => {
    await repo.saveSettings({ ...(await repo.getSettings()), closedWeekdays: [0] });
    expect((await send("10/25 21時 2名"))[0]).toContain("休業日"); // 日曜
    expect((await send("10/24 15時 2名"))[0]).toContain("営業時間外");
    expect((await send("10/24 21時 2名", "U2"))[0]).toContain("承りました");
    expect((await send("10/24 21時 2名", "U3"))[0]).toContain("承りました");
    expect((await send("10/24 21時 2名", "U4"))[0]).toContain("承りました");
    expect((await send("10/24 21時 2名", "U5"))[0]).toContain("満席");
  });

  it("cancels the guest's upcoming reservation and removes the calendar event", async () => {
    await send("10/25 21時 2名");
    const [reply] = await send("すみません、キャンセルでお願いします");
    expect(reply).toContain("キャンセルしました");
    const [r] = await repo.listReservations({});
    expect(r.status).toBe("cancelled");
    expect(calendar.events.size).toBe(0);
  });

  it("changes the time of an existing reservation", async () => {
    await send("10/25 21時 2名");
    const [reply] = await send("22時に変更できますか");
    expect(reply).toContain("変更しました");
    expect(reply).toContain("10/25(日) 22:00");
    const all = await repo.listReservations({});
    expect(all).toHaveLength(1);
    expect(all[0].startAt).toBe(fromJst("2026-10-25", "22:00").toISOString());
    expect(calendar.events.get(all[0].googleEventId!)!.startAt).toBe(all[0].startAt);
  });

  it("asks which reservation when the guest has several", async () => {
    await send("10/25 21時 2名");
    await send("10/31 21時 2名");
    expect((await send("キャンセルします"))[0]).toContain("複数");
    expect((await send("10/31の予約をキャンセルします"))[0]).toContain("10/31");
  });

  it("forwards non-reservation messages to the owner without replying", async () => {
    expect(await send("駐車場はありますか？")).toEqual([]);
    expect(notices[0]).toContain("お店の対応が必要");
  });

  it("does not auto-reply in manual mode", async () => {
    await repo.saveSettings({ ...(await repo.getSettings()), manualMode: true });
    expect(await send("10/25 21時 2名")).toEqual([]);
    expect(await repo.listReservations({})).toHaveLength(0);
    expect(notices[0]).toContain("手動モード");
  });

  it("never double-books when two requests race for the last seats", async () => {
    await send("10/25 21時 2名", "U-a");
    const service = make();
    const results = await Promise.all([
      service.handleIncoming({ channel: "line", externalId: "U-b", displayName: "b", text: "10/25 21時 4名" }),
      service.handleIncoming({ channel: "line", externalId: "U-c", displayName: "c", text: "10/25 21時 4名" }),
    ]);
    const confirmed = await repo.listReservations({ statuses: ["confirmed"] });
    expect(confirmed.reduce((n, r) => n + r.partySize, 0)).toBeLessThanOrEqual(6);
    expect(results.flat().filter((t) => t.includes("満席"))).toHaveLength(1);
  });

  it("registers manual reservations and refuses full slots unless forced", async () => {
    const service = make();
    const ok = await service.createManual({ date: "2026-10-25", time: "21:00", partySize: 6, name: "電話 田中", notes: null, force: false });
    expect(ok.ok).toBe(true);
    const full = await service.createManual({ date: "2026-10-25", time: "21:00", partySize: 1, name: "佐藤", notes: null, force: false });
    expect(full).toMatchObject({ ok: false });
    const forced = await service.createManual({ date: "2026-10-25", time: "21:00", partySize: 1, name: "佐藤", notes: null, force: true });
    expect(forced.ok).toBe(true);
  });

  it("sends reminders once for the next business night only", async () => {
    await send("10/20 24時半 2名"); // 今夜の深夜帯 → 対象外
    await send("10/21 21時 2名", "U2");
    await send("10/21 25時 2名", "U3"); // 明日の夜の深夜帯 → 対象
    await send("10/25 21時 2名", "U4");
    now = fromJst("2026-10-20", "12:00");
    expect(await make().sendReminders()).toBe(2);
    expect(pushed.map((p) => p.customer.externalId).sort()).toEqual(["U2", "U3"]);
    expect(pushed[0].text).toContain("明日のご予約");
    expect(await make().sendReminders()).toBe(0);
  });

  it("holds parties larger than the whole bar as a private-hire request", async () => {
    await repo.saveSettings({ ...(await repo.getSettings()), maxPartySize: 4 });
    const [reply] = await send("10/25 21時 10名で貸切できますか");
    expect(reply).toContain("店主が確認");
    expect((await repo.listReservations({}))[0]).toMatchObject({ status: "pending", partySize: 10 });
  });

  it("keeps the date when only the time was outside business hours", async () => {
    expect((await send("10/25 15時 2名"))[0]).toContain("営業時間外");
    expect((await send("21時でお願いします"))[0]).toContain("10/25(日) 21:00");
  });

  it("lets the owner edit a reservation, re-syncs the calendar and notifies the guest", async () => {
    await send("10/25 21時 2名");
    const [r] = await repo.listReservations({});
    await repo.updateReservation(r.id, { reminderSentAt: now.toISOString() });
    const result = await make().editByShop(r.id, {
      date: "2026-10-25",
      time: "22:30",
      partySize: 3,
      name: "山田",
      notes: "窓側",
      force: false,
      notifyCustomer: true,
    });
    expect(result.ok).toBe(true);
    const updated = (await repo.getReservation(r.id))!;
    expect(updated).toMatchObject({ partySize: 3, notes: "窓側", reminderSentAt: null });
    expect(updated.startAt).toBe(fromJst("2026-10-25", "22:30").toISOString());
    expect(calendar.events.get(updated.googleEventId!)!.startAt).toBe(updated.startAt);
    expect(pushed[0].text).toContain("10/25(日) 22:30");
  });

  it("does not count the reservation itself when checking capacity on edit", async () => {
    await send("10/25 21時 6名"); // 満席ちょうど（承認待ち）
    const [r] = await repo.listReservations({});
    const same = await make().editByShop(r.id, {
      date: "2026-10-25", time: "21:00", partySize: 6, name: "山田", notes: null, force: false, notifyCustomer: false,
    });
    expect(same.ok).toBe(true);
    await make().createManual({ date: "2026-10-25", time: "23:00", partySize: 6, name: "B", notes: null, force: false });
    const clash = await make().editByShop(r.id, {
      date: "2026-10-25", time: "22:00", partySize: 6, name: "山田", notes: null, force: false, notifyCustomer: false,
    });
    expect(clash).toMatchObject({ ok: false });
    expect(pushed).toHaveLength(0);
  });

  it("retries calendar sync for reservations missing an event and alerts on failures", async () => {
    let fail = true;
    calendar.upsert = async (r) => {
      if (fail) throw new Error("google down");
      return `evt-${r.id}`;
    };
    await send("10/25 21時 2名");
    expect((await repo.listReservations({}))[0].googleEventId).toBeNull();
    expect(await make().retryCalendarSync()).toBe(0);
    expect(notices.at(-1)).toContain("反映できていない予約が1件");
    fail = false;
    expect(await make().retryCalendarSync()).toBe(1);
    expect((await repo.listReservations({}))[0].googleEventId).not.toBeNull();
  });

  it("sends tonight's reservation list before opening", async () => {
    await send("10/20 21時 2名。誕生日です");
    await send("10/20 25時 3名", "U2");
    await send("10/21 21時 2名", "U3");
    now = fromJst("2026-10-20", "17:00");
    const text = await make().sendDailyDigest();
    expect(text).toContain("【本日の予約 10/20】2組 5名");
    expect(text).toContain("21:00 やまだ様 2名 / 誕生日です");
    expect(text).toContain("01:00");
    expect(text).not.toContain("10/21");
  });

  it("records who did what in the history", async () => {
    await send("10/25 21時 5名");
    const [r] = await repo.listReservations({});
    await make().approve(r.id);
    await make().markVisit(r.id, true, "staff");
    const logs = await repo.listAudit({ targetId: r.id, limit: 10 });
    expect(logs.map((l) => [l.actor, l.action])).toEqual([
      ["staff", "来店"],
      ["owner", "承認"],
      ["guest", "予約受付（承認待ち）"],
    ]);
    expect(logs[2].detail).toContain("10/25(日) 21:00");
  });

  it("keeps working when the history cannot be written", async () => {
    repo.addAudit = async () => {
      throw new Error("db down");
    };
    expect((await send("10/25 21時 2名"))[0]).toContain("承りました");
  });

  it("purges personal data past the retention period but keeps sale amounts", async () => {
    await repo.saveSettings({ ...(await repo.getSettings()), retentionMonths: 1 });
    await send("10/21 21時 2名。山田です");
    const [old] = await repo.listReservations({});
    const customer = (await repo.getCustomer(old.customerId))!;
    const sale = await repo.createSale({
      businessDate: "2026-10-21", reservationId: old.id, customerId: customer.id, staffId: null, channel: "line",
      customerName: "山田", partySize: 2, drinkAmount: 5000, chargeAmount: 2000, serviceAmount: 700, note: "常連",
    });
    const result = await repo.purgePersonalData(fromJst("2026-12-01", "00:00"));
    expect(result.reservations).toBe(1);
    expect(result.sales).toBe(1);
    expect((await repo.getReservation(old.id))!.name).toBe("（削除済み）");
    const purgedSale = (await repo.getSale(sale.id))!;
    expect(purgedSale).toMatchObject({ customerName: null, note: null, drinkAmount: 5000, serviceAmount: 700 });
    expect(await repo.getCustomer(customer.id)).toMatchObject({ name: null, displayName: null, externalId: null });
    expect(await repo.listMessages(customer.id, new Date(0), 10)).toEqual([]);
  });

  it("skips purging when retention is 0 and records a history entry otherwise", async () => {
    await repo.saveSettings({ ...(await repo.getSettings()), retentionMonths: 0 });
    expect(await make().purgeExpiredPersonalData()).toBeNull();
    await repo.saveSettings({ ...(await repo.getSettings()), retentionMonths: 1 });
    await send("10/21 21時 2名");
    now = new Date(Date.now() + 40 * 24 * 3600_000);
    const result = await make().purgeExpiredPersonalData();
    expect(result!.messages).toBeGreaterThan(0);
    expect((await repo.listAudit({ limit: 1 }))[0].action).toBe("保存期間を過ぎた個人情報を削除");
  });

  it("pulls moves and deletions made directly in Google Calendar", async () => {
    await send("10/25 21時 2名", "U1");
    await send("10/25 22時 2名", "U2");
    await send("10/31 21時 2名", "U3");
    const [a, b, c] = await repo.listReservations({});
    calendar.remote.set(a.googleEventId!, { start: fromJst("2026-10-25", "23:00"), end: fromJst("2026-10-25", "25:00") });
    calendar.remote.set(b.googleEventId!, "deleted");

    expect(await make().pullCalendarChanges()).toEqual({ moved: 1, deleted: 1, failed: 0 });
    expect((await repo.getReservation(a.id))!.startAt).toBe(fromJst("2026-10-25", "23:00").toISOString());
    expect((await repo.getReservation(b.id))!).toMatchObject({ status: "cancelled", googleEventId: null });
    expect((await repo.getReservation(c.id))!.status).toBe("confirmed");
    expect(notices.some((n) => n.includes("【カレンダーで移動】"))).toBe(true);
    expect(notices.some((n) => n.includes("【カレンダーで削除】"))).toBe(true);
    // お客様には自動で連絡しない
    expect(pushed).toHaveLength(0);
    // 2回目は変化なし
    expect(await make().pullCalendarChanges()).toEqual({ moved: 0, deleted: 0, failed: 0 });
  });

  describe("web booking form", () => {
    const form = (over = {}) => ({
      date: "2026-10-24", time: "21:00", partySize: 2, name: "鈴木", phone: "090-1234-5678", notes: null, ...over,
    });

    it("normalizes Japanese phone numbers", () => {
      expect(normalizePhone("０９０−１２３４−５６７８")).toBe("09012345678");
      expect(normalizePhone("+81 90 1234 5678")).toBe("09012345678");
      expect(normalizePhone("03-1234-5678")).toBe("0312345678");
      expect(normalizePhone("12345")).toBeNull();
    });

    it("confirms small parties, keeps the phone, and links repeat guests", async () => {
      const first = await make().handleWebBooking(form());
      expect(first.status).toBe("confirmed");
      if (first.status !== "confirmed") throw new Error();
      expect(first.reservation).toMatchObject({ channel: "web", name: "鈴木", notes: "電話: 09012345678" });
      expect(first.reservation.googleEventId).not.toBeNull();
      expect(notices[0]).toContain("予約フォーム・電話 09012345678");
      const second = await make().handleWebBooking(form({ date: "2026-10-31", phone: "09012345678" }));
      if (second.status !== "confirmed") throw new Error();
      expect(second.reservation.customerId).toBe(first.reservation.customerId);
    });

    it("holds large parties and private hire for approval", async () => {
      expect((await make().handleWebBooking(form({ partySize: 5 }))).status).toBe("pending");
      expect((await make().handleWebBooking(form({ date: "2026-10-31", notes: "貸切希望" }))).status).toBe("pending");
    });

    it("rejects invalid input and full slots with alternatives", async () => {
      expect(await make().handleWebBooking(form({ phone: "abc" }))).toMatchObject({ status: "invalid" });
      expect(await make().handleWebBooking(form({ name: " " }))).toMatchObject({ status: "invalid" });
      expect(await make().handleWebBooking(form({ time: "15:00" }))).toMatchObject({ status: "unavailable" });
      await make().handleWebBooking(form({ partySize: 4 }));
      await make().handleWebBooking(form({ partySize: 2, phone: "09000000000" }));
      const full = await make().handleWebBooking(form({ partySize: 2, phone: "09011111111" }));
      expect(full.status).toBe("unavailable");
      if (full.status !== "unavailable") throw new Error();
      expect(full.error).toContain("満席");
      expect(full.alternatives.length).toBeGreaterThan(0);
    });

    it("tells the owner to call when a form guest cannot be messaged", async () => {
      const service = new ReservationService({
        repo,
        extractor,
        calendar,
        messenger: {
          push: async () => {
            throw new Error("このお客様にはアプリから連絡できません。お電話でご連絡ください");
          },
        },
        notifier: { notify: async (t) => void notices.push(t) },
        now: () => now,
      });
      const r = await service.handleWebBooking(form({ partySize: 5 }));
      if (r.status !== "pending") throw new Error();
      await service.approve(r.reservation.id);
      expect(notices.at(-1)).toContain("手動で連絡してください");
      // 送れていないメッセージは送信済みとして残さない
      expect(await repo.listMessages(r.reservation.customerId, new Date(0), 10)).toEqual([]);
    });
  });

  describe("quick replies", () => {
    const sendQ = (text: string, externalId = "U1") =>
      make().handleIncomingWithQuickReplies({ channel: "line", externalId, displayName: "やまだ", text });

    it("offers dates, then available times, then party sizes", async () => {
      const first = await sendQ("予約したいです");
      expect(first.quickReplies.slice(0, 2)).toEqual([
        { label: "今日", text: "10/20" },
        { label: "明日", text: "10/21" },
      ]);
      const second = await sendQ("土曜");
      expect(second.quickReplies[0]).toEqual({ label: "19時", text: "19時" });
      expect(second.quickReplies.map((q) => q.label)).toContain("21時");
      const third = await sendQ("21時");
      expect(third.quickReplies.map((q) => q.label)).toEqual(["1名", "2名", "3名", "4名"]);
      const done = await sendQ("2名");
      expect(done.replies[0]).toContain("承りました");
      expect(done.quickReplies).toEqual([]);
    });

    it("only offers times with enough seats for the party", async () => {
      await send("10/24 21時 6名", "U-full"); // 満席（承認待ちでも席は押さえる）
      const r = await sendQ("10/24に3名で");
      const labels = r.quickReplies.map((q) => q.label);
      expect(labels).not.toContain("21時");
      expect(labels).not.toContain("20時");
      expect(labels).toContain("23時");
    });

    it("tapped answers are understood", async () => {
      await sendQ("予約したいです");
      await sendQ("10/24");
      await sendQ("深夜1時");
      const r = await sendQ("2名");
      expect(r.replies[0]).toContain("10/25(日) 01:00");
    });
  });

  describe("party size changes", () => {
    it("applies '1人増えます' to the guest's reservation", async () => {
      await send("10/25 21時 2名");
      const [reply] = await send("1人増えます！");
      expect(reply).toContain("変更しました");
      expect(reply).toContain("3名");
      expect((await repo.listReservations({}))[0].partySize).toBe(3);
    });

    it("applies decreases and absolute changes", async () => {
      await send("10/25 21時 4名");
      await send("すみません1名減ります");
      expect((await repo.listReservations({}))[0].partySize).toBe(3);
      await send("1人増えて5人になりました");
      expect((await repo.listReservations({}))[0].partySize).toBe(5);
    });

    it("forwards to the owner when there is nothing to change", async () => {
      const [reply] = await send("2人追加でお願いします");
      expect(reply).toContain("お店で確認");
      expect(notices.at(-1)).toContain("+2名");
      expect(await repo.listReservations({})).toHaveLength(0);
    });

    it("forwards to the owner instead of auto-replying to a late notice", async () => {
      await send("10/25 21時 2名");
      expect(await send("30分くらい遅れます")).toEqual([]);
      expect(notices.at(-1)).toContain("遅れます");
    });
  });

  it("includes the shop phone when asking for a phone call", async () => {
    await repo.saveSettings({ ...(await repo.getSettings()), shopPhone: "03-1234-5678" });
    now = fromJst("2026-10-20", "20:50");
    const [reply] = await send("今日21時 2名");
    expect(reply).toContain("お電話（03-1234-5678）");
  });

  describe("booking form options", () => {
    it("lists only future slots with remaining seats per date", async () => {
      now = fromJst("2026-10-20", "21:10");
      await make().createManual({ date: "2026-10-21", time: "21:00", partySize: 6, name: "満席", notes: null, force: false });
      const [today, tomorrow] = await make().bookingOptions(["2026-10-20", "2026-10-21"]);
      // 21:10 + 受付締切30分 → 22:00 から
      expect(today.slots[0].clock).toBe("22:00");
      expect(today.slots.at(-1)!.clock).toBe("25:00");
      expect(tomorrow.slots[0]).toMatchObject({ clock: "19:00", remaining: 6 });
      expect(tomorrow.slots.find((s) => s.clock === "21:00")!.remaining).toBe(0);
      expect(tomorrow.slots.find((s) => s.clock === "23:00")!.remaining).toBe(6);
    });

    it("returns no slots for closed days", async () => {
      await repo.saveSettings({ ...(await repo.getSettings()), closedDates: ["2026-10-22"] });
      const [closed] = await make().bookingOptions(["2026-10-22"]);
      expect(closed.slots).toEqual([]);
    });
  });

  it("records bookings from the X link as X and never tries to message them", async () => {
    const r = await make().handleWebBooking({
      source: "x", date: "2026-10-24", time: "21:00", partySize: 2, name: "X太郎", phone: "09011112222", notes: null,
    });
    if (r.status !== "confirmed") throw new Error();
    expect(r.reservation.channel).toBe("x");
    expect((await repo.getCustomer(r.reservation.customerId))!.channel).toBe("x");
    expect(notices.at(-1)).toContain("予約フォーム（X経由）");
  });
});

describe("birthday greetings", () => {
  it("greets LINE customers on their birthday once a year", async () => {
    const repo = new MemoryRepository();
    await repo.saveSettings({ ...(await repo.getSettings()), birthdayGreetingEnabled: true, birthdayMessage: "{name}様おめでとう" });
    const pushed: string[] = [];
    const notices: string[] = [];
    let now = fromJst("2026-10-30", "12:00");
    const make = () =>
      new ReservationService({
        repo,
        extractor: new RuleBasedExtractor(),
        calendar: { upsert: async () => "e", remove: async () => {}, busyBlocks: async () => [], getEvent: async () => "deleted" as const },
        messenger: { push: async (c, text) => void pushed.push(`${c.externalId}:${text}`) },
        notifier: { notify: async (t) => void notices.push(t) },
        now: () => now,
      });
    const line = await repo.findOrCreateCustomer("line", "U1", "やまだ");
    await repo.updateCustomer(line.id, { name: "山田", birthday: "10-30" });
    const other = await repo.findOrCreateCustomer("line", "U2", "さとう");
    await repo.updateCustomer(other.id, { birthday: "10-31" });
    // 電話で登録したお客様にはアプリから送れない
    await repo.createCustomer({ channel: "manual", name: "鈴木", phone: "09000000000", birthday: "10-30", tags: [], note: null, staffId: null });

    expect(await make().sendBirthdayGreetings()).toBe(1);
    expect(pushed).toEqual(["U1:山田様おめでとう"]);
    expect(notices[0]).toContain("1名");
    expect(await make().sendBirthdayGreetings()).toBe(0); // 同じ年は一度だけ

    now = fromJst("2027-10-30", "12:00");
    expect(await make().sendBirthdayGreetings()).toBe(1);

    await repo.saveSettings({ ...(await repo.getSettings()), birthdayGreetingEnabled: false });
    now = fromJst("2028-10-30", "12:00");
    expect(await make().sendBirthdayGreetings()).toBe(0);
  });

  it("greets Feb 29 birthdays on Feb 28 in non-leap years", async () => {
    const repo = new MemoryRepository();
    await repo.saveSettings({ ...(await repo.getSettings()), birthdayGreetingEnabled: true });
    const pushed: string[] = [];
    const c = await repo.findOrCreateCustomer("line", "U1", "うるう");
    await repo.updateCustomer(c.id, { birthday: "02-29" });
    const service = new ReservationService({
      repo,
      extractor: new RuleBasedExtractor(),
      calendar: { upsert: async () => "e", remove: async () => {}, busyBlocks: async () => [], getEvent: async () => "deleted" as const },
      messenger: { push: async (_c, text) => void pushed.push(text) },
      notifier: { notify: async () => {} },
      now: () => fromJst("2027-02-28", "12:00"),
    });
    expect(await service.sendBirthdayGreetings()).toBe(1);
    expect(pushed[0]).toContain("うるう様");
  });
});
