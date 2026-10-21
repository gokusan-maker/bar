import { describe, expect, it } from "vitest";
import { availabilityBoard, checkAvailability, peakOccupancy, suggestAlternatives, type AvailabilityInput } from "./availability";
import { addDays, formatJa, fromJst, toJst, weekdayOf } from "./time";
import { DEFAULT_SETTINGS } from "./types";

describe("time", () => {
  it("converts JST wall-clock to UTC and back", () => {
    const d = fromJst("2026-10-25", "21:00");
    expect(d.toISOString()).toBe("2026-10-25T12:00:00.000Z");
    expect(toJst(d)).toEqual({ date: "2026-10-25", time: "21:00", weekday: 0 });
  });

  it("treats hours past 24 as the next day", () => {
    expect(toJst(fromJst("2026-10-25", "25:30"))).toMatchObject({ date: "2026-10-26", time: "01:30" });
  });

  it("handles month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-10-20")).toBe(2);
  });

  it("formats in Japanese", () => {
    expect(formatJa(fromJst("2026-10-25", "21:00"))).toBe("10/25(日) 21:00");
  });

  it("rejects invalid input", () => {
    expect(() => fromJst("2026-02-30", "21:00")).toThrow();
    expect(() => fromJst("2026-02-01", "21:75")).toThrow();
  });
});

describe("availability", () => {
  // 2026-10-20(火) 15:00 JST
  const now = fromJst("2026-10-20", "15:00");
  const base = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
    settings: { ...DEFAULT_SETTINGS, capacity: 10 },
    now,
    start: fromJst("2026-10-25", "21:00"),
    partySize: 2,
    occupancy: [],
    blocks: [],
    ...over,
  });

  it("accepts a normal request and ends after the stay duration", () => {
    const r = checkAvailability(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.businessDate).toBe("2026-10-25");
      expect(r.end.getTime() - r.start.getTime()).toBe(120 * 60_000);
    }
  });

  it("assigns after-midnight starts to the previous business day", () => {
    const r = checkAvailability(base({ start: fromJst("2026-10-25", "24:30") }));
    expect(r).toMatchObject({ ok: true, businessDate: "2026-10-25" });
  });

  it("clips the end to closing time", () => {
    const r = checkAvailability(base({ start: fromJst("2026-10-25", "24:30") }));
    if (!r.ok) throw new Error("expected ok");
    expect(r.end).toEqual(fromJst("2026-10-25", "26:00"));
  });

  it("rejects after the last entry time and outside hours", () => {
    expect(checkAvailability(base({ start: fromJst("2026-10-25", "25:30") }))).toMatchObject({
      ok: false,
      reason: "outside_hours",
    });
    expect(checkAvailability(base({ start: fromJst("2026-10-25", "15:00") }))).toMatchObject({
      ok: false,
      reason: "outside_hours",
    });
  });

  it("rejects closed days, past, too soon and too far", () => {
    const sun = 0;
    expect(
      checkAvailability(base({ settings: { ...DEFAULT_SETTINGS, closedWeekdays: [sun] } })),
    ).toMatchObject({ ok: false, reason: "closed_day" });
    expect(
      checkAvailability(base({ settings: { ...DEFAULT_SETTINGS, closedDates: ["2026-10-25"] } })),
    ).toMatchObject({ ok: false, reason: "closed_day" });
    expect(checkAvailability(base({ start: fromJst("2026-10-19", "21:00") }))).toMatchObject({ reason: "past" });
    expect(
      checkAvailability(base({ now: fromJst("2026-10-25", "20:50") })),
    ).toMatchObject({ reason: "too_soon" });
    expect(checkAvailability(base({ start: fromJst("2027-03-01", "21:00") }))).toMatchObject({ reason: "too_far" });
  });

  it("detects full capacity using overlapping reservations only", () => {
    const occ = (s: string, e: string, n: number) => ({
      start: fromJst("2026-10-25", s),
      end: fromJst("2026-10-25", e),
      partySize: n,
    });
    // 19-21 に6名、21-23 に6名。21:00開始の2名は 6+2 <= 10 でOK（19-21組は21時に退店）
    expect(
      checkAvailability(base({ occupancy: [occ("19:00", "21:00", 6), occ("22:00", "24:00", 2)] })).ok,
    ).toBe(true);
    expect(
      checkAvailability(base({ occupancy: [occ("20:00", "22:00", 5), occ("21:30", "23:30", 4)] })),
    ).toMatchObject({ ok: false, reason: "full" });
  });

  it("computes peak occupancy with a sweep", () => {
    const range = { start: fromJst("2026-10-25", "20:00"), end: fromJst("2026-10-25", "24:00") };
    const occ = [
      { start: fromJst("2026-10-25", "19:00"), end: fromJst("2026-10-25", "21:00"), partySize: 3 },
      { start: fromJst("2026-10-25", "21:00"), end: fromJst("2026-10-25", "23:00"), partySize: 4 },
      { start: fromJst("2026-10-25", "22:00"), end: fromJst("2026-10-26", "00:00"), partySize: 2 },
    ];
    expect(peakOccupancy(range, occ)).toBe(6);
  });

  it("blocks times overlapping calendar events", () => {
    const blocks = [{ start: fromJst("2026-10-25", "22:00"), end: fromJst("2026-10-25", "26:00") }];
    expect(checkAvailability(base({ blocks }))).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("suggests nearby open slots on the same night", () => {
    const occupancy = [
      { start: fromJst("2026-10-25", "20:00"), end: fromJst("2026-10-25", "22:30"), partySize: 10 },
    ];
    const alts = suggestAlternatives(base({ occupancy }));
    expect(alts.map((d) => toJst(d).time)).toEqual(["22:30", "23:00", "23:30"]);
  });

  it("builds an hourly availability board for a night", () => {
    const occupancy = [
      { start: fromJst("2026-10-25", "21:00"), end: fromJst("2026-10-25", "23:00"), partySize: 7 },
    ];
    const blocks = [{ start: fromJst("2026-10-25", "24:00"), end: fromJst("2026-10-25", "26:00") }];
    const board = availabilityBoard({ ...base({ occupancy, blocks }) }, "2026-10-25");
    expect(board.map((s) => [s.clock, s.remaining])).toEqual([
      ["19:00", 10], // 19-21: 21時からの7名とは重ならない
      ["20:00", 3],
      ["21:00", 3],
      ["22:00", 3], // 22-24: 24時からの貸切とはちょうど重ならない
      ["23:00", 0], // 23-25: 貸切に重なる
      ["24:00", 0],
      ["25:00", 0],
    ]);
  });
});
