import { beforeEach, describe, expect, it } from "vitest";
import { fromJst } from "./domain/time";
import { RuleBasedExtractor } from "./extraction/rule-based";
import { bookingButtons, PromoService, type PromoLine } from "./promo-service";
import { MemoryRepository } from "./repo/memory";
import { ReservationService } from "./reservation-service";

class FakeLine implements PromoLine {
  sent: { texts: string[]; buttons: { label: string; text: string }[] }[] = [];
  limit: number | null = 200;
  used = 0;
  reach: number | null = 50;
  fail = false;
  async broadcast(texts: string[], buttons: { label: string; text: string }[]) {
    if (this.fail) throw new Error("LINE down");
    this.sent.push({ texts, buttons });
  }
  async quota() {
    return { limit: this.limit, used: this.used };
  }
  async reachEstimate() {
    return this.reach;
  }
}

describe("PromoService", () => {
  let repo: MemoryRepository;
  let line: FakeLine;
  let notices: string[];
  let published: { url: string; caption: string }[];
  let now: Date;

  const reservations = () =>
    new ReservationService({
      repo,
      extractor: new RuleBasedExtractor(),
      calendar: { upsert: async () => "evt", remove: async () => {}, busyBlocks: async () => [], getEvent: async () => "deleted" as const },
      messenger: { push: async () => {} },
      notifier: { notify: async () => {} },
      now: () => now,
    });
  const promo = (withInstagram = false) =>
    new PromoService({
      repo,
      availabilityBoard: (d) => reservations().availabilityBoard(d),
      line,
      instagram: withInstagram ? { publishPhoto: async (url, caption) => (published.push({ url, caption }), "m1") } : null,
      notify: async (t) => void notices.push(t),
      baseUrl: "https://bar.example",
      shopUrl: "https://bar.example/s/test",
      shopId: "shop-1",
      now: () => now,
    });

  beforeEach(async () => {
    repo = new MemoryRepository();
    // 2026-10-20 は火曜。19:00〜翌2:00 営業
    await repo.saveSettings({
      ...(await repo.getSettings()),
      shopName: "Bar Test",
      openTime: "19:00",
      closeTime: "02:00",
      closedWeekdays: [],
      promoEnabled: true,
      promoTime: "evening",
      promoMessage: "今夜は限定ウイスキーあります",
    });
    line = new FakeLine();
    notices = [];
    published = [];
    now = fromJst("2026-10-20", "17:00");
  });

  it("broadcasts tonight's availability with one-tap booking buttons, once a day", async () => {
    expect(await promo().runScheduled("noon")).toMatchObject({ sent: false });
    expect(await promo().runScheduled("evening")).toMatchObject({ sent: true, line: true });
    const [msg] = line.sent;
    expect(msg.texts[0]).toContain("今夜は限定ウイスキーあります");
    expect(msg.texts[0]).toContain("【本日の空き状況】Bar Test");
    expect(msg.buttons[0]).toEqual({ label: "19:00〜で予約", text: "10/20 19:00から予約したいです" });
    expect(msg.buttons.at(-1)?.label).toBe("別の日にする");
    expect(msg.buttons.length).toBeLessThanOrEqual(13);
    // 同じ日に二度目は送らない
    expect(await promo().runScheduled("evening")).toMatchObject({ sent: false, reason: "今日はもう配信しました" });
    expect(line.sent).toHaveLength(1);
  });

  it("turns a tapped button into a reservation through the normal auto-reply flow", async () => {
    await promo().runScheduled("evening");
    const tap = line.sent[0].buttons.find((b) => b.text.includes("21:00"))!;
    const [ask] = await reservations().handleIncoming({ channel: "line", externalId: "U1", displayName: "やまだ", text: tap.text });
    expect(ask).toContain("人数");
    const [done] = await reservations().handleIncoming({ channel: "line", externalId: "U1", displayName: "やまだ", text: "2名 山田です" });
    expect(done).toContain("承りました");
    const [r] = await repo.listReservations({});
    expect(r).toMatchObject({ status: "confirmed", partySize: 2, channel: "line" });
    expect(r.startAt).toBe(fromJst("2026-10-20", "21:00").toISOString());
  });

  it("skips days off, past slots and full nights", async () => {
    await repo.saveSettings({ ...(await repo.getSettings()), promoWeekdays: [5, 6] });
    expect(await promo().runScheduled("evening")).toMatchObject({ sent: false, reason: "配信しない曜日です" });
    await repo.saveSettings({ ...(await repo.getSettings()), promoWeekdays: [0, 1, 2, 3, 4, 5, 6] });
    // 閉店後は空きがないので送らない（満席の連絡もしない）
    now = fromJst("2026-10-20", "26:30");
    expect(await promo().runScheduled("evening")).toMatchObject({ sent: false });
    expect(line.sent).toHaveLength(0);
    expect(notices).toHaveLength(0);
  });

  it("does not exceed the monthly LINE message limit and tells the owner", async () => {
    line.used = 180;
    line.reach = 50;
    expect(await promo().sendNow()).toMatchObject({ sent: false, line: false });
    expect(line.sent).toHaveLength(0);
    expect(notices[0]).toContain("送信通数の残り（20通）");
    line.limit = null; // 上限なしのプラン
    expect(await promo().sendNow()).toMatchObject({ sent: true });
  });

  it("posts to Instagram with the promo image when enabled", async () => {
    await repo.saveSettings({ ...(await repo.getSettings()), promoInstagram: true, promoImageKey: "abc", lineFriendUrl: "https://lin.ee/x" });
    line.fail = true;
    const r = await promo(true).sendNow();
    expect(r).toMatchObject({ sent: true, line: false, instagram: true });
    expect(published[0].url).toBe("https://bar.example/promo-image/shop-1/abc");
    expect(published[0].caption).toContain("https://lin.ee/x");
    expect(notices[0]).toContain("LINEの配信に失敗しました");
  });

  it("labels after-midnight buttons with the clock time but books the business day", () => {
    const start = fromJst("2026-10-20", "25:00");
    expect(bookingButtons("2026-10-20", [{ start, clock: "25:00", remaining: 3 }])[0]).toEqual({
      label: "1:00〜で予約",
      text: "10/20 25:00から予約したいです",
    });
  });
});
