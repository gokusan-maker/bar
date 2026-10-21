import { describe, expect, it } from "vitest";
import { fromJst } from "../domain/time";
import { extractByRules } from "./rule-based";
import type { Extraction } from "./schema";

// 2026-10-20(火) 15:00、営業 19:00〜26:00
const read = (text: string) =>
  extractByRules({ text, history: [], now: fromJst("2026-10-20", "15:00"), openTime: "19:00", closeTime: "26:00", draft: null });

type Expect = Partial<Extraction>;

/** お店に実際に届きそうな書き方 */
const CASES: [string, Expect][] = [
  ["今週末2人で行きたいです", { intent: "new", date: "2026-10-24", partySize: 2 }],
  ["週末あいてますか？", { intent: "new", date: "2026-10-24" }],
  ["金曜の夜9時頃に3人でお願いします", { intent: "new", date: "2026-10-23", time: "21:00", partySize: 3 }],
  ["明日20時〜4名で予約できますか？", { date: "2026-10-21", time: "20:00", partySize: 4 }],
  ["来週土曜、夜8時半から友人と2人です", { date: "2026-10-31", time: "20:30", partySize: 2 }],
  ["10月31日 ハロウィンに5人で", { date: "2026-10-31", partySize: 5 }],
  ["今夜空いてますか？ふたりです", { intent: "new", date: "2026-10-20", partySize: 2 }],
  ["9pm 2名", { time: "21:00", partySize: 2 }],
  ["午後10時から3名", { time: "22:00", partySize: 3 }],
  ["21:30〜2名様でお願いします。名前は田中です", { time: "21:30", partySize: 2, name: "田中" }],
  ["予約者：佐藤 明日21時 2名", { name: "佐藤", date: "2026-10-21" }],
  ["鈴木で予約お願いします。土曜22時、4人", { name: "鈴木", date: "2026-10-24", time: "22:00", partySize: 4 }],
  ["予約したいんですけど、明後日の22時から6名って大丈夫ですか", { intent: "new", date: "2026-10-22", time: "22:00", partySize: 6 }],
  ["今週の金曜日 9時半 大人3名", { date: "2026-10-23", time: "21:30", partySize: 3 }],
  ["次の土曜 7時から", { date: "2026-10-24", time: "19:00" }],
  ["２０時に２名で", { time: "20:00", partySize: 2 }],
  // 変更・キャンセル
  ["やっぱり行けなくなりました、すみません", { intent: "cancel" }],
  ["今日のキャンセルお願いします", { intent: "cancel" }],
  ["予約やめます", { intent: "cancel" }],
  ["1人増えて3人になりました", { intent: "change", partySize: 3, partyDelta: null }],
  ["1人増えます！", { intent: "change", partySize: null, partyDelta: 1 }],
  ["2人追加でお願いします", { intent: "change", partySize: null, partyDelta: 2 }],
  ["すみません1名減ります", { intent: "change", partySize: null, partyDelta: -1 }],
  ["1人キャンセルになりました", { intent: "change", partyDelta: -1 }],
  ["人数を4人に変更したいです", { intent: "change", partySize: 4 }],
  ["22時に変えられますか？", { intent: "change", time: "22:00" }],
  // 店主が対応すべきもの
  ["30分くらい遅れます", { intent: "inquiry" }],
  ["駐車場はありますか？", { intent: "inquiry" }],
  ["何時まで営業してますか？", { intent: "inquiry" }],
];

describe("rule-based reader on realistic messages", () => {
  it.each(CASES)("%s", (text, expected) => {
    expect(read(text)).toMatchObject(expected);
  });
});
