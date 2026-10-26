import { adConfig } from "@/lib/ads";

/** AdSense の ads.txt（サイトのいちばん上に置く必要がある） */
export function GET() {
  const config = adConfig();
  if (!config) return new Response("", { status: 404 });
  const pub = config.client.replace(/^ca-/, "");
  return new Response(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
