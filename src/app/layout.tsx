import type { Metadata, Viewport } from "next";
import { repository } from "@/lib/container";
import { THEMES, isThemeKey } from "@/lib/domain/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "予約管理",
  description: "SNSの予約を自動で受け付けてGoogleカレンダーに反映するバー予約管理",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // ログイン前や公開ページでは店舗が決まらないことがあるので、そのときは標準の色
  const themeColor = await repository()
    .getSettings()
    .then((s) => s.themeColor)
    .catch(() => "amber");
  const theme = THEMES[isThemeKey(themeColor) ? themeColor : "amber"];
  return (
    <html
      lang="ja"
      style={{ "--accent-light": theme.light, "--accent-dark": theme.dark } as React.CSSProperties}
    >
      <body>{children}</body>
    </html>
  );
}
