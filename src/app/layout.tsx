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
  const { themeColor } = await repository().getSettings();
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
