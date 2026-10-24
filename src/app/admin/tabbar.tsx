"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, React.ReactNode> = {
  calendar: <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
  yen: <path d="M6 4l6 8 6-8M12 12v8M8 13h8M8 16.5h8" />,
  people: (
    <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.8 2.6 3 5.2" />
  ),
  glass: <path d="M6 3h12l-1.5 7a4.5 4.5 0 0 1-9 0L6 3ZM12 14.5V20M8.5 20h7M6.6 6h10.8" />,
  chat: <path d="M4 5h16v11H9l-5 4V5Z" />,
  gear: (
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2.1 1.2L14.7 21h-4l-.3-2.4a7 7 0 0 1-2.1-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.4 9.9l2-3.4 1.9.7a7 7 0 0 1 2.1-1.2L10.7 3h4l.3 2.4a7 7 0 0 1 2.1 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4Z" />
  ),
};

const OWNER_TABS = [
  { href: "/admin", label: "予約", icon: "calendar", match: ["/admin", "/admin/reservations", "/admin/new", "/admin/post"] },
  { href: "/admin/orders", label: "注文", icon: "glass", match: ["/admin/orders", "/admin/menu"] },
  { href: "/admin/sales", label: "売上", icon: "yen", match: ["/admin/sales", "/admin/staff"] },
  { href: "/admin/customers", label: "お客様", icon: "people", match: ["/admin/customers"] },
  { href: "/admin/inbox", label: "メッセージ", icon: "chat", match: ["/admin/inbox", "/admin/simulator"] },
  { href: "/admin/settings", label: "設定", icon: "gear", match: ["/admin/settings", "/admin/history", "/admin/diagnostics"] },
];

/** スマホ用の下部タブ（店主のみ。スタッフは予約一覧だけなので出さない） */
export function TabBar() {
  const path = usePathname();
  const active = (match: string[]) =>
    match.some((m) => (m === "/admin" ? path === "/admin" : path === m || path.startsWith(`${m}/`)));
  return (
    <nav className="tabbar" aria-label="メインメニュー">
      {OWNER_TABS.map((t) => (
        <Link key={t.href} href={t.href} className={active(t.match) ? "active" : ""} aria-current={active(t.match) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[t.icon]}
          </svg>
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
