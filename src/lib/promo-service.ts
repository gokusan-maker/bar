import type { SlotAvailability } from "./domain/availability";
import { availabilityPost } from "./domain/post";
import { addDays, toJst, weekdayOf } from "./domain/time";
import type { ShopSettings } from "./domain/types";
import type { Repository } from "./repo/types";

export interface PromoLine {
  broadcast(texts: string[], quickReplies: { label: string; text: string }[]): Promise<void>;
  quota(): Promise<{ limit: number | null; used: number }>;
  reachEstimate(yyyymmdd: string): Promise<number | null>;
}

export interface PromoInstagram {
  publishPhoto(imageUrl: string, caption: string): Promise<string>;
}

export interface PromoDeps {
  repo: Repository;
  availabilityBoard(businessDate: string): Promise<SlotAvailability[]>;
  line: PromoLine | null;
  instagram: PromoInstagram | null;
  notify(text: string): Promise<void>;
  baseUrl: string | null;
  /** この店舗の公開URLの土台（https://…/s/<店舗>）。予約フォームのリンクに使う */
  shopUrl: string | null;
  shopId: string;
  now?: () => Date;
}

export interface PromoResult {
  sent: boolean;
  /** 送らなかった・一部失敗した理由（店主向けの文） */
  reason?: string;
  line?: boolean;
  instagram?: boolean;
}

const clockLabel = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return `${h >= 24 ? h - 24 : h}:${String(m).padStart(2, "0")}`;
};

/** 空いている時間のボタン。タップすると予約の文が送られ、そのまま自動受付で予約が進む */
export function bookingButtons(businessDate: string, slots: SlotAvailability[]) {
  const [, m, d] = businessDate.split("-").map(Number);
  const buttons = slots
    .filter((s) => s.remaining > 0)
    .slice(0, 12)
    .map((s) => ({ label: `${clockLabel(s.clock)}〜で予約`, text: `${m}/${d} ${s.clock}から予約したいです` }));
  return [...buttons, { label: "別の日にする", text: "別の日に予約したいです" }];
}

/** 配信する文面（LINE用・Instagram用） */
export function promoTexts(settings: ShopSettings, businessDate: string, slots: SlotAvailability[], shopUrl: string | null) {
  const reserveUrl = settings.webBookingEnabled && shopUrl ? `${shopUrl}/reserve` : null;
  const head = settings.promoMessage.trim();
  // LINEの友だちにはLINEの案内は不要。ボタンで予約できることを伝える
  const lineBody = availabilityPost(settings, businessDate, slots, { isToday: true, reserveUrl: null, lineUrl: null })
    .split("\n")
    .filter((l) => !l.startsWith("ご予約は"))
    .join("\n");
  const line = [head, lineBody, "下のボタンで時間を選ぶと、そのままご予約できます👇"].filter(Boolean).join("\n\n");
  const instagram = [head, availabilityPost(settings, businessDate, slots, { isToday: true, reserveUrl, lineUrl: settings.lineFriendUrl || null })]
    .filter(Boolean)
    .join("\n\n");
  return { line, instagram };
}

export class PromoService {
  constructor(private readonly deps: PromoDeps) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  /** 今の営業日（朝6時より前は前日） */
  private businessDate(): string {
    const p = toJst(this.now());
    return p.time < "06:00" ? addDays(p.date, -1) : p.date;
  }

  /** 定期実行から呼ぶ。設定の時刻・曜日で、まだ送っていなければ送る */
  async runScheduled(slot: "noon" | "evening"): Promise<PromoResult> {
    const settings = await this.deps.repo.getSettings();
    if (!settings.promoEnabled) return { sent: false, reason: "自動配信はオフです" };
    if (settings.promoTime !== slot) return { sent: false, reason: "配信の時刻ではありません" };
    const date = this.businessDate();
    if (!settings.promoWeekdays.includes(weekdayOf(date))) return { sent: false, reason: "配信しない曜日です" };
    if (settings.promoLastSentDate === date) return { sent: false, reason: "今日はもう配信しました" };
    return this.send(settings, date, true);
  }

  /** 管理画面の「今すぐ配信」 */
  async sendNow(): Promise<PromoResult> {
    const settings = await this.deps.repo.getSettings();
    return this.send(settings, this.businessDate(), false);
  }

  private async send(settings: ShopSettings, date: string, scheduled: boolean): Promise<PromoResult> {
    const { repo, line, instagram } = this.deps;
    const slots = (await this.deps.availabilityBoard(date)).filter((s) => s.start > this.now());
    if (!slots.some((s) => s.remaining > 0)) {
      return this.skip(scheduled, "今日は空きがない（満席・休業・受付時間外）ため、配信しませんでした");
    }
    if (!line && !(settings.promoInstagram && instagram)) {
      return this.skip(scheduled, "LINE（またはInstagram）が未接続のため配信できません");
    }

    const texts = promoTexts(settings, date, slots, this.deps.shopUrl);
    const failures: string[] = [];
    let lineSent = false;
    let igSent = false;

    if (line) {
      try {
        // 無料・ライトプランは月の上限を超えると送れないので、届く人数の目安と残りを比べる
        const { limit, used } = await line.quota();
        const yesterday = addDays(toJst(this.now()).date, -1).replaceAll("-", "");
        const reach = (await line.reachEstimate(yesterday)) ?? 0;
        if (limit !== null && used + reach > limit) {
          failures.push(`LINEの今月の送信通数の残り（${Math.max(0, limit - used)}通）が、友だちの数（約${reach}人）より少ないため送りませんでした`);
        } else {
          await line.broadcast([texts.line], bookingButtons(date, slots));
          lineSent = true;
        }
      } catch (error) {
        failures.push(`LINEの配信に失敗しました: ${(error as Error).message.slice(0, 120)}`);
      }
    }
    if (settings.promoInstagram && instagram) {
      if (!settings.promoImageKey || !this.deps.baseUrl) {
        failures.push("Instagramに投稿する画像（またはAPP_BASE_URL）が未設定です");
      } else {
        try {
          await instagram.publishPhoto(`${this.deps.baseUrl}/promo-image/${this.deps.shopId}/${settings.promoImageKey}`, texts.instagram);
          igSent = true;
        } catch (error) {
          failures.push(`Instagramの投稿に失敗しました: ${(error as Error).message.slice(0, 120)}`);
        }
      }
    }

    if (lineSent || igSent) {
      await repo.saveSettings({ ...(await repo.getSettings()), promoLastSentDate: date });
      await repo.addAudit({
        actor: scheduled ? "system" : "owner",
        action: "空き状況を配信",
        targetType: "settings",
        targetId: null,
        detail: [lineSent && "LINE", igSent && "Instagram"].filter(Boolean).join("・"),
      });
    }
    if (failures.length) await this.deps.notify(`【集客の配信】\n${failures.join("\n")}`);
    return { sent: lineSent || igSent, line: lineSent, instagram: igSent, reason: failures.join(" / ") || undefined };
  }

  private async skip(scheduled: boolean, reason: string): Promise<PromoResult> {
    // 自動の配信で送れなかったときは店主に知らせる（満席はお知らせ不要）
    if (scheduled && !reason.startsWith("今日は空きがない")) await this.deps.notify(`【集客の配信】${reason}`);
    return { sent: false, reason };
  }
}
