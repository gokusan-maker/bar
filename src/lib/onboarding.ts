import "server-only";
import { repository, shopSecrets } from "./container";

export interface SetupStep {
  key: string;
  label: string;
  href: string;
  done: boolean;
}

/** 新しいお店の最初の設定の進み具合（オーナーの予約一覧の先頭に出す） */
export async function setupSteps(): Promise<SetupStep[]> {
  const repo = repository();
  const [settings, secrets, staff, menu, audit] = await Promise.all([
    repo.getSettings(),
    shopSecrets(),
    repo.listStaff(),
    repo.listMenu(),
    repo.listAudit({ limit: 200 }),
  ]);
  return [
    {
      key: "settings",
      label: "お店の席・営業時間・受付ルールを設定する",
      href: "/admin/settings",
      done: audit.some((a) => a.action === "設定を変更"),
    },
    {
      key: "line",
      label: "LINE公式アカウントをつなぐ（自動で予約を受け付ける）",
      href: "/admin/settings",
      done: !!(secrets.lineChannelAccessToken && secrets.lineChannelSecret),
    },
    {
      key: "reserve",
      label: "予約フォームを公開する（Instagram・Xのプロフィールに載せる）",
      href: "/admin/settings",
      done: settings.webBookingEnabled,
    },
    { key: "menu", label: "メニューと席のQRコードを作る（お酒の注文）", href: "/admin/menu", done: menu.length > 0 },
    { key: "staff", label: "スタッフを招待する", href: "/admin/staff", done: staff.length > 0 },
  ];
}
