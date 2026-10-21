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
