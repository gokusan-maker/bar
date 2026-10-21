import { describe, expect, it } from "vitest";
import { fromJst } from "../domain/time";
import { extractByRules, normalizeClock, parseDate, parseName, parseParty, parseTime } from "./rule-based";

// 2026-10-20(火)
const TODAY = "2026-10-20";
const TUE = 2;

describe("parseDate", () => {
  it.each([
    ["10/25に行きたいです", "2026-10-25"],
    ["10月25日", "2026-10-25"],
    ["2027/1/5", "2027-01-05"],
    ["1/5", "2027-01-05"],
    ["今日", "2026-10-20"],
    ["今夜空いてますか", "2026-10-20"],
    ["明日", "2026-10-21"],
    ["あさって", "2026-10-22"],
    ["土曜", "2026-10-24"],
    ["今週の土曜", "2026-10-24"],
    ["来週の金曜日", "2026-10-30"],
    ["火曜", "2026-10-20"],
    ["25日", "2026-10-25"],
    ["5日", "2026-11-05"],
    ["２５日", null], // NFKC 正規化は extractByRules で行う
  ])("%s → %s", (text, expected) => {
    expect(parseDate(text, TODAY, TUE)).toBe(expected);
  });
});

describe("parseTime", () => {
  it.each([
    ["21時", "21:00"],
    ["9時", "21:00"],
    ["9時半", "21:30"],
    ["20:15", "20:15"],
    ["1時", "25:00"],
    ["0時", "24:00"],
    ["8時10分", "20:10"],
  ])("%s → %s", (text, expected) => {
    expect(parseTime(text, "19:00", "26:00")).toBe(expected);
  });

  it("keeps out-of-hours times as-is", () => {
    expect(normalizeClock(15, 0, "19:00", "26:00")).toBe("15:00");
  });

  it("supports close times written as early morning", () => {
    expect(normalizeClock(1, 0, "19:00", "02:00")).toBe("25:00");
  });
});

describe("parseParty / parseName", () => {
  it.each([
    ["2名", 2],
    ["3人で", 3],
    ["ふたり", 2],
    ["二人", 2],
    ["一人です", 1],
    ["おひとり様", 1],
  ])("%s → %d", (text, n) => {
    expect(parseParty(text)).toBe(n);
  });

  it.each([
    ["山田です", "山田"],
    ["名前は佐藤です", "佐藤"],
    ["鈴木と申します", "鈴木"],
    ["21時からです", null],
    ["今夜24時から5名で行けますか?佐藤です", "佐藤"],
  ])("%s → %s", (text, name) => {
    expect(parseName(text)).toBe(name);
  });
});

describe("extractByRules", () => {
  const ctx = (text: string, draft = null as Parameters<typeof extractByRules>[0]["draft"]) => ({
    text,
    history: [],
    now: fromJst(TODAY, "15:00"),
    openTime: "19:00",
    closeTime: "26:00",
    draft,
  });

  it("extracts a full request", () => {
    expect(extractByRules(ctx("１０/２５(土) ９時から２名でお願いします。誕生日です"))).toEqual({
      intent: "new",
      date: "2026-10-25",
      time: "21:00",
      partySize: 2,
      partyDelta: null,
      name: null,
      notes: "誕生日です",
      confidence: "medium",
    });
  });

  it("merges with the draft", () => {
    const r = extractByRules(
      ctx("3人です", { date: "2026-10-25", time: "21:00", partySize: null, name: null, notes: null }),
    );
    expect(r).toMatchObject({ intent: "new", date: "2026-10-25", time: "21:00", partySize: 3 });
  });

  it("detects cancel and change", () => {
    expect(extractByRules(ctx("すみません、キャンセルでお願いします")).intent).toBe("cancel");
    expect(extractByRules(ctx("22時に変更できますか")).intent).toBe("change");
    expect(extractByRules(ctx("駐車場はありますか？")).intent).toBe("inquiry");
  });
});
