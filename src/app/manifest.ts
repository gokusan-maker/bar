import type { MetadataRoute } from "next";
import { siteInfo } from "@/lib/site";

export const dynamic = "force-dynamic";

/** スマホのホーム画面に追加したとき、アプリのように全画面で開く */
export default function manifest(): MetadataRoute.Manifest {
  const { appName } = siteInfo();
  return {
    name: appName,
    short_name: "バー予約",
    description: "予約・集客・注文・売上の管理",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    background_color: "#f6f5f2",
    theme_color: "#8a5a12",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
