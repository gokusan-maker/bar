import type { Metadata, Viewport } from "next";
import { repository } from "@/lib/container";
import { THEMES, isThemeKey } from "@/lib/domain/theme";
import Script from "next/script";
import { adConfig } from "@/lib/ads";
import "./globals.css";

export const metadata: Metadata = {
  title: "予約管理",
  description: "SNSの予約を自動で受け付けてGoogleカレンダーに反映するバー予約管理",
  // ホーム画面に追加したときのアイコンと名前
  icons: { icon: "/icon-192.png", apple: "/icon-180.png" },
  appleWebApp: { capable: true, title: "バー予約", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#8a5a12",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // ログイン前や公開ページでは店舗が決まらないことがあるので、そのときは標準の色
  const themeColor = await repository()
    .getSettings()
    .then((s) => s.themeColor)
    .catch(() => "amber");
  const ads = adConfig();
  const theme = THEMES[isThemeKey(themeColor) ? themeColor : "amber"];
  return (
    <html
      lang="ja"
      style={{ "--accent-light": theme.light, "--accent-dark": theme.dark } as React.CSSProperties}
    >
      <body>
        {children}
        {ads && (
          // 広告を出す設定のときだけ AdSense を読み込む
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ads.client}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
