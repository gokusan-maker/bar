import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { directory, repository, reservationService } from "@/lib/container";
import { formatJa } from "@/lib/domain/time";
import { STATUS_LABEL } from "@/lib/domain/types";
import { readGuestReservationToken } from "@/lib/guest-link";
import { withShop } from "@/lib/shop-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ご予約の確認", robots: { index: false } };

async function cancelAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const link = readGuestReservationToken(token);
  if (!link) redirect("/");
  const back = (q: string) => redirect(`/r/${encodeURIComponent(token)}?${q}`);
  if (formData.get("confirm") !== "on") back(`error=${encodeURIComponent("「キャンセルする」にチェックを入れてください")}`);
  const result = await withShop(link.shopId, () => reservationService().cancelByGuest(link.reservationId));
  back(result.ok ? "cancelled=1" : `error=${encodeURIComponent(result.error)}`);
}

/** お客様が自分の予約を確認・キャンセルするページ（予約フォームの完了画面からのリンク） */
export default async function GuestReservationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ cancelled?: string; error?: string }>;
}) {
  const { token } = await params;
  const { cancelled, error } = await searchParams;
  const link = readGuestReservationToken(decodeURIComponent(token));
  const shop = link ? await directory().getShop(link.shopId) : null;
  const data =
    link && shop?.active
      ? await withShop(link.shopId, async () => ({
          r: await repository().getReservation(link.reservationId),
          settings: await repository().getSettings(),
        }))
      : null;
  if (!data?.r) {
    return (
      <main className="container" style={{ maxWidth: 480, paddingTop: 40 }}>
        <p className="notice error">ご予約が見つかりません。お店にお問い合わせください。</p>
      </main>
    );
  }
  const { r, settings } = data;
  const active = r.status === "pending" || r.status === "confirmed";
  const upcoming = new Date(r.startAt) > new Date();
  return (
    <main className="container" style={{ maxWidth: 480, paddingTop: 40 }}>
      <h1>{settings.shopName}</h1>
      <h2>ご予約の確認</h2>
      {cancelled && <p className="notice success">キャンセルしました。またのご来店をお待ちしております。</p>}
      {error && <p className="notice error">{error}</p>}
      <section className="card">
        <p style={{ fontSize: "1.2rem", margin: "4px 0" }}>{formatJa(new Date(r.startAt))}</p>
        <p style={{ margin: "4px 0" }}>
          {r.name}様　{r.partySize}名
        </p>
        <p className="muted" style={{ margin: "4px 0" }}>
          状態：{STATUS_LABEL[r.status]}
        </p>
      </section>
      {active && upcoming && (
        <form action={cancelAction} className="card">
          <input type="hidden" name="token" value={decodeURIComponent(token)} />
          <label>
            <input type="checkbox" name="confirm" required /> このご予約をキャンセルする
          </label>
          <button type="submit">キャンセルする</button>
          <p className="muted" style={{ marginBottom: 0 }}>
            日時や人数の変更は、いったんキャンセルして予約し直すか、{settings.shopPhone ? `お電話（${settings.shopPhone}）` : "お店"}にご連絡ください。
          </p>
        </form>
      )}
      <footer className="site-footer">
        <a href="/privacy">プライバシーポリシー</a>
      </footer>
    </main>
  );
}
