import { directory, shopRepository } from "@/lib/container";

/** 集客投稿の画像。Instagramのサーバーが取りに来るので、ログインなしで公開する */
export async function GET(_req: Request, { params }: { params: Promise<{ shopId: string; key: string }> }) {
  const { shopId, key } = await params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key) || !(await directory().getShop(shopId))) return new Response("not found", { status: 404 });
  const image = await shopRepository(shopId).getPromoImage(key);
  if (!image) return new Response("not found", { status: 404 });
  return new Response(image.data as BodyInit, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
