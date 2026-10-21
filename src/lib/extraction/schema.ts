import { z } from "zod";

export const ExtractionSchema = z.object({
  intent: z
    .enum(["new", "change", "cancel", "inquiry", "other"])
    .describe("new=新規予約, change=予約の変更, cancel=キャンセル, inquiry=予約以外の質問, other=それ以外"),
  date: z
    .string()
    .nullable()
    .describe("来店する営業日 YYYY-MM-DD。深夜の来店でも、その夜の営業日（開店した日）を入れる。不明なら null"),
  time: z
    .string()
    .nullable()
    .describe("来店時刻 HH:MM。営業日の0時からの時刻で、深夜1時は 25:00 のように24以上で書く。不明なら null"),
  partySize: z.number().int().nullable().describe("人数。不明なら null"),
  partyDelta: z
    .number()
    .int()
    .nullable()
    .describe("「1人増えます」「2名減ります」のように人数の増減だけが書かれている場合の増減（+1, -2 など）。それ以外は null"),
  name: z.string().nullable().describe("予約者の名前（名乗った場合のみ）。不明なら null"),
  notes: z
    .string()
    .nullable()
    .describe("席の希望・誕生日などの要望。なければ null"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("日時・人数の読み取りにどれだけ自信があるか。あいまいな表現や矛盾があれば low"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ExtractionContext {
  /** 今回届いたメッセージ */
  text: string;
  /** 直近のやり取り（古い順） */
  history: { direction: "in" | "out"; text: string }[];
  now: Date;
  /** 店の種類（バー、スナックなど） */
  shopType?: string;
  openTime: string;
  closeTime: string;
  /** 聞き取り途中の情報 */
  draft: {
    date: string | null;
    time: string | null;
    partySize: number | null;
    name: string | null;
    notes: string | null;
  } | null;
}

export interface Extractor {
  extract(ctx: ExtractionContext): Promise<Extraction>;
}
