import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.line.me/v2/bot";

/** Webhookの署名検証（x-line-signature） */
export function verifyLineSignature(rawBody: string, signature: string | null, channelSecret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest();
  const actual = Buffer.from(signature, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface LineTextEvent {
  replyToken: string;
  userId: string;
  text: string;
}

interface LineWebhookBody {
  events?: {
    type: string;
    replyToken?: string;
    source?: { type: string; userId?: string };
    message?: { type: string; text?: string };
  }[];
}

/** 1対1トークのテキストメッセージだけを取り出す */
export function parseLineEvents(body: LineWebhookBody): LineTextEvent[] {
  return (body.events ?? []).flatMap((e) =>
    e.type === "message" &&
    e.message?.type === "text" &&
    e.message.text &&
    e.replyToken &&
    e.source?.type === "user" &&
    e.source.userId
      ? [{ replyToken: e.replyToken, userId: e.source.userId, text: e.message.text }]
      : [],
  );
}

/** LINEの送信形式に変換（最大5件、クイックリプライは最大13個・ラベル20文字まで） */
export function lineMessages(texts: string[], quickReplies: { label: string; text: string }[] = []) {
  const messages: Record<string, unknown>[] = texts.slice(0, 5).map((text) => ({ type: "text", text }));
  if (quickReplies.length && messages.length) {
    messages[messages.length - 1].quickReply = {
      items: quickReplies.slice(0, 13).map((q) => ({
        type: "action",
        action: { type: "message", label: q.label.slice(0, 20), text: q.text },
      })),
    };
  }
  return messages;
}

export class LineClient {
  constructor(private readonly accessToken: string) {}

  private async call(path: string, init: RequestInit) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`LINE API ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res;
  }

  /** 返信（無料。replyTokenは受信から短時間のみ有効）。選択肢は最後のメッセージにボタンとして付ける */
  async reply(replyToken: string, texts: string[], quickReplies: { label: string; text: string }[] = []) {
    if (!texts.length) return;
    await this.call("/message/reply", {
      method: "POST",
      body: JSON.stringify({ replyToken, messages: lineMessages(texts, quickReplies) }),
    });
  }

  /** プッシュ送信（送信通数にカウントされる） */
  async push(userId: string, text: string) {
    await this.call("/message/push", {
      method: "POST",
      body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] }),
    });
  }

  /** 友だち全員に一斉送信（友だちの人数分、送信通数にカウントされる） */
  async broadcast(texts: string[], quickReplies: { label: string; text: string }[] = []) {
    if (!texts.length) return;
    await this.call("/message/broadcast", {
      method: "POST",
      body: JSON.stringify({ messages: lineMessages(texts, quickReplies) }),
    });
  }

  /** 今月の送信通数。limit が null なら上限なし（追加メッセージを購入できるプラン） */
  async quota(): Promise<{ limit: number | null; used: number }> {
    const [quota, usage] = await Promise.all([
      this.call("/message/quota", { method: "GET" }).then((r) => r.json() as Promise<{ type: string; value?: number }>),
      this.call("/message/quota/consumption", { method: "GET" }).then((r) => r.json() as Promise<{ totalUsage: number }>),
    ]);
    return { limit: quota.type === "limited" ? (quota.value ?? 0) : null, used: usage.totalUsage };
  }

  /** 一斉送信が届く人数の目安（前日の集計。集計前や取得できなければ null） */
  async reachEstimate(yyyymmdd: string): Promise<number | null> {
    try {
      const res = await this.call(`/insight/followers?date=${yyyymmdd}`, { method: "GET" });
      const body = (await res.json()) as { status?: string; targetedReaches?: number };
      return body.status === "ready" && typeof body.targetedReaches === "number" ? body.targetedReaches : null;
    } catch {
      return null;
    }
  }

  /** 接続確認用: 公式アカウントの名前 */
  async botName(): Promise<string> {
    const res = await this.call("/info", { method: "GET" });
    const info = (await res.json()) as { displayName?: string; basicId?: string };
    return `${info.displayName ?? ""}${info.basicId ? `（${info.basicId}）` : ""}`;
  }

  async displayName(userId: string): Promise<string | null> {
    try {
      const res = await this.call(`/profile/${encodeURIComponent(userId)}`, { method: "GET" });
      const profile = (await res.json()) as { displayName?: string };
      return profile.displayName ?? null;
    } catch {
      return null;
    }
  }
}
