import { repository } from "@/lib/container";

/** 集客投稿の画像。Instagramのサーバーが取りに来るので、ログインなしで公開する */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return new Response("not found", { status: 404 });
  const image = await repository().getPromoImage(key);
  if (!image) return new Response("not found", { status: 404 });
  return new Response(image.data as BodyInit, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
