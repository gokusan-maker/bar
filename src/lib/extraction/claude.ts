import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { toJst, weekdayJa } from "../domain/time";
import { ExtractionSchema, type Extraction, type ExtractionContext, type Extractor } from "./schema";
import { extractByRules } from "./rule-based";

const MODEL = "claude-opus-5-5";

const SYSTEM_PROMPT = `あなたは夜営業の飲食店（バー・スナックなど。種類は context に記載）の予約受付係です。お客様からSNSで届いたメッセージを読み、予約に必要な情報を抽出します。

ルール:
- 「今週の土曜」「明日」「9時」などの相対的な表現は、与えられた現在日時（日本時間）と営業時間をもとに具体的な日付・時刻に直してください。
- 夜のお店なので「9時」は通常21時、「1時」は深夜1時を指します。営業時間内に収まる解釈を選んでください。
- date は来店する夜の営業日です。深夜0時以降の来店は、前日の営業日の 24:00 以降の時刻（例: 25:00）として表してください。
- これまでのやり取りと「聞き取り途中の情報」がある場合は、それらと今回のメッセージを合わせた最新の内容を返してください。今回のメッセージで変更された項目は新しい値を優先します。
- 変更の場合は変更後の日時・人数を返してください。人数の増減だけが書かれている場合（「1人増えます」）は partySize を null にして partyDelta に増減を入れてください。
- 書かれていない情報を推測で埋めないでください。不明な項目は null にします。
- 読み取りがあいまい、または矛盾がある場合は confidence を low にしてください。
- 「遅れます」などの連絡や、予約と関係のない質問は inquiry にしてください。`;

export class ClaudeExtractor implements Extractor {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : undefined);
  }

  async extract(ctx: ExtractionContext): Promise<Extraction> {
    const now = toJst(ctx.now);
    const context = {
      現在日時: `${now.date}(${weekdayJa(now.weekday)}) ${now.time} JST`,
      店の種類: ctx.shopType ?? "バー",
      営業時間: `${ctx.openTime}〜${ctx.closeTime}`,
      聞き取り途中の情報: ctx.draft,
      これまでのやり取り: ctx.history.map(
        (h) => `${h.direction === "in" ? "お客様" : "店"}: ${h.text}`,
      ),
    };
    try {
      const response = await this.client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(ExtractionSchema) },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `<context>\n${JSON.stringify(context, null, 2)}\n</context>\n\n<message>\n${ctx.text}\n</message>`,
          },
        ],
      });
      if (response.stop_reason === "refusal" || !response.parsed_output) {
        // 判断できなかったものは店主確認に回す
        return { ...extractByRules(ctx), confidence: "low" };
      }
      return response.parsed_output;
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        console.error(`Claude API error ${error.status}: ${error.message}`);
      } else {
        console.error("Claude extraction failed", error);
      }
      // API障害時も予約受付を止めないよう、簡易抽出で続行する（自動確定はしない）
      return { ...extractByRules(ctx), confidence: "low" };
    }
  }
}
