import { addDays, isValidDate, parseClock, toJst } from "../domain/time";
import type { Extraction, ExtractionContext, Extractor } from "./schema";

/**
 * APIキーがない環境やClaude APIの障害時に使う、正規表現ベースの簡易抽出。
 * 下書き（draft）とマージした結果を返す。
 */
export class RuleBasedExtractor implements Extractor {
  async extract(ctx: ExtractionContext): Promise<Extraction> {
    return extractByRules(ctx);
  }
}

const KANJI_NUM: Record<string, number> = {
  一: 1, ひと: 1, 二: 2, ふた: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
const WEEKDAYS = "日月火水木金土";

export function extractByRules(ctx: ExtractionContext): Extraction {
  const text = ctx.text.normalize("NFKC");
  const today = toJst(ctx.now);

  const date = parseDate(text, today.date, today.weekday);
  const time = parseTime(text, ctx.openTime, ctx.closeTime);
  const partyDelta = parsePartyDelta(text);
  // 「1人増えて3人になりました」のように変更後の人数があればそちらを使う
  const absolute = /(\d{1,2}|[一二三四五六七八九十])\s*(?:名|人)\s*に(?:なり|変更|変え)/.exec(text);
  const partySize = absolute
    ? Number(absolute[1]) || KANJI_NUM[absolute[1]]
    : partyDelta !== null
      ? null
      : parseParty(text);
  const name = parseName(text);
  const notes = parseNotes(text);

  let intent: Extraction["intent"];
  if (partyDelta !== null || absolute) intent = "change";
  else if (/キャンセル|取り?消|行けなく|いけなく|やめ(ます|たい|る)|中止/.test(text)) intent = "cancel";
  else if (/変更|ずら|変え|かえて|人数を/.test(text)) intent = "change";
  else if (/遅れ|遅刻|おくれ/.test(text)) intent = "inquiry"; // 遅刻の連絡は店主が対応
  else if (date || time || partySize || /予約|空いて|あいて|席/.test(text)) intent = "new";
  else if (ctx.draft) intent = "new"; // 聞き返しへの返答（名前だけ等）
  else if (/[?？]/.test(text)) intent = "inquiry";
  else intent = "other";

  const d = ctx.draft;
  const merged = {
    date: date ?? d?.date ?? null,
    time: time ?? d?.time ?? null,
    partySize: partyDelta !== null && !absolute ? null : (partySize ?? d?.partySize ?? null),
    name: name ?? d?.name ?? null,
    notes: [d?.notes, notes].filter(Boolean).join(" / ") || null,
  };
  // 規則ベースでは確からしさを測れないので medium 固定（不足項目は聞き返しで補う）
  return { intent, ...merged, partyDelta: absolute ? null : partyDelta, confidence: "medium" };
}

export function parseDate(text: string, today: string, todayWeekday: number): string | null {
  let m = /(\d{4})[/年-](\d{1,2})[/月-](\d{1,2})/.exec(text);
  if (m) return toDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /(\d{1,2})[/月](\d{1,2})日?/.exec(text);
  if (m) {
    const year = Number(today.slice(0, 4));
    const candidate = toDate(year, Number(m[1]), Number(m[2]));
    // 過去の日付なら来年とみなす（年末に1月の予約が来るケース）
    if (candidate && candidate < today) return toDate(year + 1, Number(m[1]), Number(m[2]));
    return candidate;
  }

  if (/明後日|あさって/.test(text)) return addDays(today, 2);
  // 週末 → 次の土曜（今日が土曜なら今日）
  if (/週末/.test(text)) return addDays(today, (6 - todayWeekday + 7) % 7);
  if (/明日|あした|あす/.test(text)) return addDays(today, 1);
  if (/今日|本日|今夜|今晩|きょう/.test(text)) return today;

  m = /(今週|来週|再来週)?の?([日月火水木金土])曜/.exec(text);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2]);
    if (!m[1]) {
      return addDays(today, (target - todayWeekday + 7) % 7);
    }
    // 週は月曜始まり
    const monday = addDays(today, -((todayWeekday + 6) % 7));
    const weeks = m[1] === "今週" ? 0 : m[1] === "来週" ? 1 : 2;
    return addDays(monday, weeks * 7 + ((target + 6) % 7));
  }

  m = /(?<![\d/月])(\d{1,2})日(?!後|間)/.exec(text);
  if (m) {
    const [y, mo] = today.split("-").map(Number);
    const day = Number(m[1]);
    const candidate = toDate(y, mo, day);
    if (candidate && candidate >= today) return candidate;
    return mo === 12 ? toDate(y + 1, 1, day) : toDate(y, mo + 1, day);
  }
  return null;
}

function toDate(y: number, mo: number, d: number): string | null {
  const s = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidDate(s) ? s : null;
}

export function parseTime(text: string, openTime: string, closeTime: string): string | null {
  let h: number;
  let min = 0;
  let m = /(\d{1,2}):(\d{2})/.exec(text);
  if (m) {
    h = Number(m[1]);
    min = Number(m[2]);
  } else if ((m = /(\d{1,2})\s*pm\b/i.exec(text))) {
    h = (Number(m[1]) % 12) + 12;
  } else if ((m = /(\d{1,2})時(半|(\d{1,2})分?)?/.exec(text))) {
    h = Number(m[1]);
    if (m[2] === "半") min = 30;
    else if (m[3]) min = Number(m[3]);
  } else {
    return null;
  }
  if (min >= 60 || h > 47) return null;
  return normalizeClock(h, min, openTime, closeTime);
}

/**
 * 「9時」を営業時間に合わせて 21:00 に、「1時」を 25:00 に読み替える。
 * 返り値は営業日の0時起点の "HH:MM"（24以上あり）。
 */
export function normalizeClock(h: number, min: number, openTime: string, closeTime: string): string {
  const open = parseClock(openTime) ?? 0;
  let close = parseClock(closeTime) ?? 24 * 60;
  if (close <= open) close += 24 * 60;
  const candidates = h < 12 ? [h, h + 12, h + 24] : h < 24 ? [h, h + 24] : [h];
  const hit = candidates.find((c) => {
    const t = c * 60 + min;
    return t >= open && t < close;
  });
  const hour = hit ?? h;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseParty(text: string): number | null {
  const m = /(\d{1,2})\s*(名|人|めい)/.exec(text);
  if (m) return Number(m[1]);
  const k = /(一|二|三|四|五|六|七|八|九|十|ひと|ふた)(名|人|り)/.exec(text);
  if (k) return KANJI_NUM[k[1]];
  if (/ひとり|お一人|おひとり/.test(text)) return 1;
  return null;
}

/** 「1人増えます」「2名減ります」「1人キャンセル」→ +1 / -2 / -1。なければ null */
export function parsePartyDelta(text: string): number | null {
  const m = /(\d{1,2}|[一二三四五]|ひとり|ふたり)\s*(?:名|人)?\s*(増|追加|プラス|減|キャンセル|行けな|来られな|これな)/.exec(text);
  if (!m) return null;
  const n = Number(m[1]) || KANJI_NUM[m[1]] || (m[1] === "ひとり" ? 1 : m[1] === "ふたり" ? 2 : 0);
  if (!n) return null;
  return /増|追加|プラス/.test(m[2]) ? n : -n;
}

export function parseName(text: string): string | null {
  const patterns = [
    /(?:予約者|名前|お名前|名義)\s*[:：]\s*([^\s、。,.!！]{1,15})/,
    /^([^\s\d、。,.!！]{1,8}?)(?:様)?で予約/m,
    /(?:名前は|名義は|予約名は)\s*([^\s、。,.!！]{1,15}?)(?:です|で|。|、|$)/,
    /([^\s、。,.!！]{1,10})と申します/,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[1].replace(/様$/, "");
  }
  // 「山田です」だけの文。助詞や予約に関する語を含むものは名前ではない
  for (const sentence of text.split(/[。\n!！?？、,]/)) {
    const m = /^\s*([^\s\d]{1,8}?)(?:様)?です\s*$/.exec(sentence);
    if (m && !/[にをがはへともで]|予約|曜|時|名|人|日|願|大丈夫|了解|はい|そう/.test(m[1])) {
      return m[1];
    }
  }
  return null;
}

function parseNotes(text: string): string | null {
  const keywords = /誕生日|記念日|カウンター|テーブル|ダーツ|禁煙|喫煙|サプライズ|ケーキ|貸切|貸し切/;
  const sentences = text.split(/[。\n!！?？]/).filter((s) => keywords.test(s));
  return sentences.length ? sentences.join(" / ").trim() : null;
}
