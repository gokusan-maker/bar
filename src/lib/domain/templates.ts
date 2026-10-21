import type { UnavailableReason } from "./availability";
import { formatJa } from "./time";
import type { ShopSettings } from "./types";

export interface ReservationSummary {
  start: Date;
  partySize: number;
  name: string;
}

const summary = (r: ReservationSummary) =>
  `日時: ${formatJa(r.start)}\n人数: ${r.partySize}名\nお名前: ${r.name}様`;

export const templates = {
  confirmed: (s: ShopSettings, r: ReservationSummary) =>
    `ご予約ありがとうございます。以下の内容で承りました。\n\n${summary(r)}\n\n変更・キャンセルの際はこちらにメッセージをお送りください。${s.shopName}でお待ちしております。`,

  changed: (s: ShopSettings, r: ReservationSummary) =>
    `ご予約を以下の内容に変更しました。\n\n${summary(r)}\n\n${s.shopName}でお待ちしております。`,

  pending: (_s: ShopSettings, r: ReservationSummary) =>
    `ご予約のご希望ありがとうございます。以下の内容で店主が確認し、あらためてご連絡いたします。\n\n${summary(r)}`,

  approved: (s: ShopSettings, r: ReservationSummary) =>
    `お待たせしました。ご予約が確定しました。\n\n${summary(r)}\n\n${s.shopName}でお待ちしております。`,

  rejected: (_s: ShopSettings, r: ReservationSummary) =>
    `申し訳ございません。${formatJa(r.start)}（${r.partySize}名様）のご予約はお受けできませんでした。別の日時でよろしければ、改めてご希望をお送りください。`,

  cancelled: (_s: ShopSettings, r: ReservationSummary) =>
    `${formatJa(r.start)}（${r.partySize}名様）のご予約をキャンセルしました。またのご利用をお待ちしております。`,

  cancelledByShop: (_s: ShopSettings, r: ReservationSummary) =>
    `申し訳ございません。${formatJa(r.start)}（${r.partySize}名様）のご予約は、お店の都合によりキャンセルとさせていただきました。`,

  reminder: (s: ShopSettings, r: ReservationSummary) =>
    `明日のご予約のお知らせです。\n\n${summary(r)}\n\n${s.shopName}でお待ちしております。ご都合が悪くなった場合はこちらにご連絡ください。`,

  askMissing: (missing: ("date" | "time" | "partySize")[]) => {
    const labels = { date: "ご来店日", time: "お時間", partySize: "人数" };
    return `ご連絡ありがとうございます。ご予約にあたり、${missing.map((m) => labels[m]).join("・")}を教えていただけますか？\n（例: 10/25 21時 2名）`;
  },

  invalidDateTime: () =>
    "日時を読み取れませんでした。お手数ですが「10/25 21時 2名」のような形でお送りいただけますか？",

  unavailable: (s: ShopSettings, reason: UnavailableReason, alternatives: Date[]) => {
    const base: Record<UnavailableReason, string> = {
      past: "ご希望の日時はすでに過ぎているようです。",
      too_soon: `直前のご予約はメッセージでは承れません。お手数ですがお電話${s.shopPhone ? `（${s.shopPhone}）` : ""}か、ご来店にてお願いいたします。`,
      too_far: `ご予約は${s.maxAdvanceDays}日先まで承っております。`,
      closed_day: "申し訳ございません、その日は休業日です。",
      outside_hours: `申し訳ございません、ご希望のお時間は営業時間外です（営業時間 ${s.openTime}〜${s.closeTime}）。`,
      party_too_large: "",
      blocked: "申し訳ございません、その時間帯は貸切・休業のためご予約をお受けできません。",
      full: "申し訳ございません、ご希望のお時間は満席です。",
    };
    const alt = alternatives.length
      ? `\n\n同じ日の以下のお時間でしたらご案内できます。\n${alternatives.map((a) => `・${formatJa(a)}`).join("\n")}\nご希望の時間をお送りください。`
      : "\n\n別の日時でよろしければ、改めてご希望をお送りください。";
    return base[reason] + alt;
  },

  forwardedToOwner: () => "ご連絡ありがとうございます。お店で確認して、あらためてご連絡いたします。",

  cancelNotFound: () =>
    "キャンセルできるご予約が見つかりませんでした。お手数ですが、ご予約の日時をお知らせください。",

  ambiguousTarget: () =>
    "ご予約が複数ございます。どのご予約か、日付を添えてもう一度お送りください。",
};
