import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { directory, repository, reservationService } from "@/lib/container";
import { withShop } from "@/lib/shop-context";
import { addDays, formatJa, toJst, weekdayJa, weekdayOf } from "@/lib/domain/time";
import { DateTimePartyFields, type DateOption } from "./fields";
import type { ShopSettings } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ご予約", robots: { index: false } };

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_TOTAL = 60;

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

async function submit(formData: FormData) {
  "use server";
  const slug = String(formData.get("shop") ?? "");
  const shop = await directory().getShopBySlug(slug);
  if (!shop?.active) notFound();
  return withShop(shop.id, () => submitForShop(formData, `/s/${shop.slug}/reserve`));
}

async function submitForShop(formData: FormData, base: string) {
  const repo = repository();
  const settings = await repo.getSettings();
  if (!settings.webBookingEnabled) redirect(base);
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  // X用リンクから来た場合は、やり直し後もXとして記録する
  const suffix = field("from") === "x" ? "&from=x" : "";
  // ボットが埋める見えない欄
  if (field("website")) redirect(`${base}?s=ok${suffix}`);
  const ip = await clientIp();
  const since = new Date(Date.now() - WINDOW_MS);
  const [byIp, total] = await Promise.all([repo.countWebRequests(since, ip), repo.countWebRequests(since)]);
  if (byIp >= MAX_PER_IP || total >= MAX_TOTAL) {
    redirect(`${base}?error=` + encodeURIComponent("送信が多すぎます。しばらくしてからお試しいただくか、お電話ください。") + suffix);
  }
  await repo.recordWebRequest(ip);
  const result = await reservationService().handleWebBooking({
    source: field("from") === "x" ? "x" : "web",
    date: field("date"),
    time: field("time"),
    partySize: Number(field("partySize")),
    name: field("name"),
    phone: field("phone"),
    notes: field("notes") || null,
  });
  if (result.status === "invalid") redirect(`${base}?error=` + encodeURIComponent(result.error) + suffix);
  if (result.status === "unavailable") {
    const alt = result.alternatives.map((d) => formatJa(d)).join("、");
    redirect(
      `${base}?error=` +
        encodeURIComponent(result.error + (alt ? ` 同じ日の ${alt} でしたらご案内できます。` : "")) +
        suffix,
    );
  }
  const r = result.reservation;
  redirect(`${base}?s=${result.status}&at=${encodeURIComponent(r.startAt)}&n=${r.partySize}`);
}

/** 予約フォームに出す営業日（休業日を除く。最大60日先まで） */
function candidateDates(s: ShopSettings, today: string): string[] {
  const dates: string[] = [];
  for (let i = 0; i <= Math.min(s.maxAdvanceDays, 60); i++) {
    const d = addDays(today, i);
    if (!s.closedWeekdays.includes(weekdayOf(d)) && !s.closedDates.includes(d)) dates.push(d);
  }
  return dates;
}

/** "26:00" → "翌2:00" */
const clockLabel = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return h >= 24 ? `翌${h - 24}:${String(m).padStart(2, "0")}` : clock;
};

const slotLabel = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return h >= 24 ? `${clock}（深夜${h - 24}:${String(m).padStart(2, "0")}）` : clock;
};

/** 店舗ごとの公開の予約フォーム（/s/<店舗のURL名>/reserve） */
export default async function ReservePage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ s?: string; at?: string; n?: string; error?: string; from?: string }>;
}) {
  const shop = await directory().getShopBySlug((await routeParams).slug);
  if (!shop?.active) notFound();
  const params = await searchParams;
  return withShop(shop.id, () => renderReserve(shop.slug, params));
}

async function renderReserve(slug: string, params: { s?: string; at?: string; n?: string; error?: string; from?: string }) {
  const settings = await repository().getSettings();
  const now = toJst(new Date());
  const today = now.time < "06:00" ? addDays(now.date, -1) : now.date;
  const options: DateOption[] = settings.webBookingEnabled
    ? (await reservationService().bookingOptions(candidateDates(settings, today))).map(({ date, slots }) => {
        const [, m, d] = date.split("-").map(Number);
        return {
          date,
          label: `${m}/${d}(${weekdayJa(weekdayOf(date))})${date === today ? " 今日" : ""}`,
          slots: slots.map((s) => ({ clock: s.clock, label: slotLabel(s.clock), remaining: s.remaining })),
        };
      })
    : [];

  return (
    <main className="container" style={{ maxWidth: 520 }}>
      <h1 style={{ marginTop: 16 }}>{settings.shopName} ご予約</h1>
      <p className="muted">
        {settings.shopType} ・ 営業 {clockLabel(settings.openTime)}〜{clockLabel(settings.closeTime)}
        {settings.shopPhone && (
          <>
            {" ・ "}
            <a href={`tel:${settings.shopPhone.replace(/[^\d+]/g, "")}`}>{settings.shopPhone}</a>
          </>
        )}
      </p>
      {settings.shopMessage && <p style={{ whiteSpace: "pre-wrap" }}>{settings.shopMessage}</p>}
      {settings.lineFriendUrl && (
        <a className="button line-button" href={settings.lineFriendUrl} target="_blank" rel="noopener">
          LINEで予約・お問い合わせ（友だち追加）
        </a>
      )}

      {!settings.webBookingEnabled ? (
        <p className="notice">ただいまWebでのご予約は受け付けておりません。SNSのメッセージかお電話でお問い合わせください。</p>
      ) : params.s === "confirmed" || params.s === "pending" ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>{params.s === "confirmed" ? "ご予約を承りました" : "ご予約のご希望を受け付けました"}</h2>
          {params.at && (
            <p>
              {formatJa(new Date(params.at))}　{params.n}名様
            </p>
          )}
          <p className="muted" style={{ marginBottom: 0 }}>
            {params.s === "confirmed"
              ? "当日お待ちしております。変更・キャンセルはお電話かSNSのメッセージでご連絡ください。"
              : "内容を確認のうえ、お店からお電話でご連絡いたします。"}
          </p>
        </section>
      ) : params.s === "ok" ? (
        <p className="notice success">送信しました。</p>
      ) : (
        <>
          {params.error && <p className="notice error">{params.error}</p>}
          <form action={submit} className="card">
            <input type="hidden" name="shop" value={slug} />
            {params.from === "x" && <input type="hidden" name="from" value="x" />}
            <DateTimePartyFields options={options} maxParty={settings.maxPartySize} />
            <label>
              お名前
              <input name="name" required maxLength={40} autoComplete="name" />
            </label>
            <label>
              電話番号（確認のご連絡に使います）
              <input name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="090-1234-5678" />
            </label>
            <label>
              ご要望（任意）
              <textarea name="notes" rows={2} maxLength={300} placeholder="カウンター希望、誕生日のお祝い など" />
            </label>
            {/* ボット対策: 人には見えない欄 */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}>
              <label>
                Website
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <p className="muted">
              {settings.maxPartySize}名を超える場合や貸切のご相談は、お電話{settings.shopPhone ? `（${settings.shopPhone}）` : ""}かSNSのメッセージでお問い合わせください。
            </p>
            <button type="submit" className="primary">
              予約する
            </button>
          </form>
        </>
      )}
    </main>
  );
}
