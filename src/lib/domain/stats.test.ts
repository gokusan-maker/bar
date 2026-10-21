import { describe, expect, it } from "vitest";
import { percent, reservationStats } from "./stats";
import type { Reservation } from "./types";

const r = (over: Partial<Reservation>): Reservation => ({
  id: Math.random().toString(),
  customerId: "c",
  startAt: "2026-10-24T12:00:00.000Z",
  endAt: "2026-10-24T14:00:00.000Z",
  partySize: 2,
  name: "x",
  notes: null,
  status: "visited",
  channel: "line",
  googleEventId: null,
  reminderSentAt: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("reservationStats", () => {
  it("computes rates, shares and weekday counts", () => {
    const list = [
      r({ status: "visited", partySize: 2 }),
      r({ status: "visited", partySize: 4, channel: "instagram" }),
      r({ status: "visited", partySize: 3, channel: "manual" }),
      r({ status: "no_show" }),
      r({ status: "cancelled", channel: "manual" }),
    ];
    const s = reservationStats(list, () => 6);
    expect(s.total).toBe(5);
    expect(s.noShowRate).toBe(0.25);
    expect(s.cancelRate).toBe(0.2);
    expect(s.snsShare).toBe(0.6);
    expect(s.averageParty).toBe(3);
    expect(s.byWeekday[6]).toBe(4);
    expect(percent(s.noShowRate)).toBe("25%");
  });

  it("returns null rates when there is no data", () => {
    const s = reservationStats([], () => 0);
    expect([s.noShowRate, s.cancelRate, s.snsShare, s.averageParty]).toEqual([null, null, null, null]);
    expect(percent(null)).toBe("—");
  });
});
