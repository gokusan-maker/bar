import "server-only";
import { after, NextResponse } from "next/server";
import { directory, instagramClient, lineClient, reservationService, shopSecrets } from "./container";
import { parseInstagramEvents, verifyMetaSignature } from "./integrations/instagram";
import { parseLineEvents, verifyLineSignature } from "./integrations/line";
import { withShop } from "./shop-context";

/** 店舗があり、利用中か */
async function activeShop(shopId: string) {
  return !!(await directory().getShop(shopId))?.active;
}

/** LINE公式アカウントからのWebhook（店舗ごとのURL） */
export async function lineWebhook(req: Request, shopId: string) {
  if (!(await activeShop(shopId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  return withShop(shopId, async () => {
    const [secrets, client] = await Promise.all([shopSecrets(), lineClient()]);
    if (!secrets.lineChannelSecret || !client) {
      return NextResponse.json({ error: "LINE is not configured" }, { status: 503 });
    }
    const raw = await req.text();
    if (!verifyLineSignature(raw, req.headers.get("x-line-signature"), secrets.lineChannelSecret)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
    const body = JSON.parse(raw);
    // 再送されたイベントは処理済みの可能性があるので二重処理しない
    const fresh = { events: (body.events ?? []).filter((e: { deliveryContext?: { isRedelivery?: boolean } }) => !e.deliveryContext?.isRedelivery) };
    const events = parseLineEvents(fresh);

    // LINEにはすぐ200を返し、解析と返信はレスポンス後に行う
    after(() =>
      withShop(shopId, async () => {
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
      }),
    );
    return NextResponse.json({ ok: true });
  });
}

/** Metaのwebhook登録時の確認リクエスト */
export async function instagramWebhookVerify(req: Request, shopId: string) {
  if (!(await activeShop(shopId))) return new Response("forbidden", { status: 403 });
  return withShop(shopId, async () => {
    const params = new URL(req.url).searchParams;
    const verifyToken = (await shopSecrets()).instagramVerifyToken;
    if (verifyToken && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === verifyToken) {
      return new Response(params.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  });
}

/** InstagramのDMのWebhook（店舗ごとのURL） */
export async function instagramWebhook(req: Request, shopId: string) {
  if (!(await activeShop(shopId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  return withShop(shopId, async () => {
    const [secrets, client] = await Promise.all([shopSecrets(), instagramClient()]);
    if (!secrets.instagramAppSecret || !client) {
      return NextResponse.json({ error: "Instagram is not configured" }, { status: 503 });
    }
    const raw = await req.text();
    if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secrets.instagramAppSecret)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
    const events = parseInstagramEvents(JSON.parse(raw));

    after(() =>
      withShop(shopId, async () => {
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
      }),
    );
    return NextResponse.json({ ok: true });
  });
}
