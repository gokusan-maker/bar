import { after, NextResponse } from "next/server";
import { lineClient, reservationService } from "@/lib/container";
import { parseLineEvents, verifyLineSignature } from "@/lib/integrations/line";

export async function POST(req: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  const client = lineClient();
  if (!secret || !client) {
    return NextResponse.json({ error: "LINE is not configured" }, { status: 503 });
  }
  const raw = await req.text();
  if (!verifyLineSignature(raw, req.headers.get("x-line-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const body = JSON.parse(raw);
  // 再送されたイベントは処理済みの可能性があるので二重処理しない
  const fresh = { events: (body.events ?? []).filter((e: { deliveryContext?: { isRedelivery?: boolean } }) => !e.deliveryContext?.isRedelivery) };
  const events = parseLineEvents(fresh);

  // LINEにはすぐ200を返し、解析と返信はレスポンス後に行う
  after(async () => {
    const service = reservationService();
    for (const event of events) {
      try {
        const displayName = await client.displayName(event.userId);
        const { replies, quickReplies } = await service.handleIncomingWithQuickReplies({
          channel: "line",
          externalId: event.userId,
          displayName,
          text: event.text,
        });
        await client.reply(event.replyToken, replies, quickReplies);
      } catch (error) {
        console.error("LINE event handling failed", error);
      }
    }
  });
  return NextResponse.json({ ok: true });
}
