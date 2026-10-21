import { describe, expect, it } from "vitest";
import { availabilityPost, seatMark } from "./post";
import { fromJst } from "./time";

const slot = (clock: string, remaining: number) => ({ start: fromJst("2026-10-24", clock), clock, remaining });

describe("availability post", () => {
  it("maps remaining seats to marks", () => {
    expect([12, 6, 3, 1, 0].map((n) => seatMark(n, 12))).toEqual(["◎", "◎", "○", "△", "×"]);
  });

  it("writes tonight's availability with a booking link", () => {
    const text = availabilityPost(
      { shopName: "Bar Test", capacity: 12 },
      "2026-10-24",
      [slot("21:00", 10), slot("22:00", 2), slot("25:00", 0)],
      { isToday: true, reserveUrl: "https://bar.example/reserve" },
    );
    expect(text).toBe(
      [
        "【本日の空き状況】Bar Test",
        "10/24(土)",
        "21:00〜 ◎",
        "22:00〜 △",
        "1:00〜 ×",
        "◎余裕あり ○空きあり △残りわずか ×満席",
        "ご予約はDMか https://bar.example/reserve から",
      ].join("\n"),
    );
  });

  it("says fully booked when nothing is left", () => {
    const text = availabilityPost({ shopName: "B", capacity: 12 }, "2026-10-24", [slot("21:00", 0)], {
      isToday: false,
      reserveUrl: null,
    });
    expect(text).toContain("10/24(土)は満席");
  });

  it("puts LINE first when a friend URL is set", () => {
    const text = availabilityPost({ shopName: "B", capacity: 12 }, "2026-10-24", [slot("21:00", 10)], {
      isToday: true,
      reserveUrl: "https://bar.example/reserve?from=x",
      lineUrl: "https://lin.ee/abc",
    });
    expect(text.split("\n").slice(-3)).toEqual([
      "ご予約はLINEで👇",
      "https://lin.ee/abc",
      "Webからも予約OK https://bar.example/reserve?from=x",
    ]);
  });
});
