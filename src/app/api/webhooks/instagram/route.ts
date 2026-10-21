import { after, NextResponse } from "next/server";
import { instagramClient, reservationService } from "@/lib/container";
import { parseInstagramEvents, verifyMetaSignature } from "@/lib/integrations/instagram";

/** Metaのwebhook登録時の確認リクエスト */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN;
  if (
    verifyToken &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === verifyToken
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  const client = instagramClient();
  if (!secret || !client) {
    return NextResponse.json({ error: "Instagram is not configured" }, { status: 503 });
  }
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const events = parseInstagramEvents(JSON.parse(raw));

  after(async () => {
    const service = reservationService();
    for (const event of events) {
      try {
        const displayName = await client.username(event.senderId);
        const { replies, quickReplies } = await service.handleIncomingWithQuickReplies({
          channel: "instagram",
          externalId: event.senderId,
          displayName,
          text: event.text,
        });
        for (const [i, text] of replies.entries()) {
          await client.send(event.senderId, text, i === replies.length - 1 ? quickReplies : []);
        }
      } catch (error) {
        console.error("Instagram event handling failed", error);
      }
    }
  });
  return NextResponse.json({ ok: true });
}
