import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Instagram API（Instagramログイン方式）のメッセージ送受信。
 * プロアカウントとMetaアプリの審査（instagram_business_manage_messages）が必要。
 */
const DEFAULT_API_BASE = "https://graph.instagram.com/v23.0";

/** X-Hub-Signature-256: sha256=<hex> の検証 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const actual = Buffer.from(header.slice("sha256=".length), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface InstagramTextEvent {
  senderId: string;
  text: string;
}

interface InstagramWebhookBody {
  object?: string;
  entry?: {
    messaging?: {
      sender?: { id: string };
      message?: { text?: string; is_echo?: boolean; is_deleted?: boolean };
    }[];
  }[];
}

/** お客様から届いたテキストDMだけを取り出す（自分の送信のエコーは除く） */
export function parseInstagramEvents(body: InstagramWebhookBody): InstagramTextEvent[] {
  if (body.object !== "instagram") return [];
  return (body.entry ?? []).flatMap((entry) =>
    (entry.messaging ?? []).flatMap((m) =>
      m.sender?.id && m.message?.text && !m.message.is_echo && !m.message.is_deleted
        ? [{ senderId: m.sender.id, text: m.message.text }]
        : [],
    ),
  );
}

export class InstagramClient {
  constructor(
    private readonly accessToken: string,
    private readonly apiBase = DEFAULT_API_BASE,
  ) {}

  /** 返信は、お客様の最後のメッセージから24時間以内のみ可能 */
  async send(recipientId: string, text: string, quickReplies: { label: string; text: string }[] = []) {
    const res = await fetch(`${this.apiBase}/me/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          text,
          // 最大13個・タイトル20文字まで。タップすると title がそのまま送られる
          ...(quickReplies.length && {
            quick_replies: quickReplies.slice(0, 13).map((q) => ({
              content_type: "text",
              title: q.label.slice(0, 20),
              payload: q.text,
            })),
          }),
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Instagram send failed: ${res.status} ${await res.text()}`);
    }
  }

  /**
   * 画像付きでフィードに投稿する（instagram_business_content_publish 権限が必要）。
   * 画像は Instagram のサーバーが imageUrl から取りに来るので、公開URLかつJPEGであること。
   */
  async publishPhoto(imageUrl: string, caption: string): Promise<string> {
    const json = async (res: Response) => {
      if (!res.ok) throw new Error(`Instagram ${res.status} ${await res.text()}`);
      return res.json() as Promise<Record<string, string>>;
    };
    const auth = { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" };
    const { user_id: igId } = await json(await fetch(`${this.apiBase}/me?fields=user_id`, { headers: auth }));
    const { id: creationId } = await json(
      await fetch(`${this.apiBase}/${igId}/media`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ image_url: imageUrl, caption: caption.slice(0, 2200) }),
      }),
    );
    // 画像の取り込みが終わるのを少し待つ
    for (let i = 0; i < 5; i++) {
      const { status_code } = await json(await fetch(`${this.apiBase}/${creationId}?fields=status_code`, { headers: auth }));
      if (status_code === "FINISHED") break;
      if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`Instagram media ${status_code}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    const { id } = await json(
      await fetch(`${this.apiBase}/${igId}/media_publish`, { method: "POST", headers: auth, body: JSON.stringify({ creation_id: creationId }) }),
    );
    return id;
  }

  /** 接続確認用: 自分のアカウント名 */
  async me(): Promise<string> {
    const res = await fetch(`${this.apiBase}/me?fields=username`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`Instagram ${res.status} ${await res.text()}`);
    return ((await res.json()) as { username?: string }).username ?? "";
  }

  async username(userId: string): Promise<string | null> {
    try {
      const res = await fetch(
        `${this.apiBase}/${encodeURIComponent(userId)}?fields=name,username`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );
      if (!res.ok) return null;
      const profile = (await res.json()) as { name?: string; username?: string };
      return profile.name || profile.username || null;
    } catch {
      return null;
    }
  }
}
