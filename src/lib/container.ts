import "server-only";
import { ClaudeExtractor } from "./extraction/claude";
import { RuleBasedExtractor } from "./extraction/rule-based";
import { GoogleCalendarSync, type GoogleOAuthConfig } from "./integrations/google-calendar";
import { InstagramClient } from "./integrations/instagram";
import { LineClient } from "./integrations/line";
import type { LineLoginConfig } from "./integrations/line-login";
import type { StripeConfig } from "./integrations/stripe";
import { shopAccess, type Access } from "./domain/billing";
import { noopCalendar, type CalendarSync, type Messenger, type Notifier } from "./ports";
import { canMessage, DEFAULT_SHOP_ID, type ShopSecrets } from "./domain/types";
import { MemoryDirectory, SupabaseDirectory, type ShopDirectory } from "./directory";
import { contextShopId } from "./shop-context";
import { SupabaseRepository } from "./repo/supabase";
import type { Repository } from "./repo/types";
import { ReservationService } from "./reservation-service";
import { PromoService } from "./promo-service";
import { SalesService } from "./sales-service";

const env = (name: string) => process.env[name]?.trim() || undefined;

export function appBaseUrl(): string | null {
  return env("APP_BASE_URL")?.replace(/\/$/, "") ?? null;
}

export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  const base = appBaseUrl();
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/api/google/callback` };
}

/** LINEログイン（LINE_LOGIN_CHANNEL_ID・LINE_LOGIN_CHANNEL_SECRET・APP_BASE_URL がそろったとき） */
export function lineLoginConfig(): LineLoginConfig | null {
  const channelId = env("LINE_LOGIN_CHANNEL_ID");
  const channelSecret = env("LINE_LOGIN_CHANNEL_SECRET");
  const base = appBaseUrl();
  if (!channelId || !channelSecret || !base) return null;
  return { channelId, channelSecret, redirectUri: `${base}/api/line-login/callback` };
}

/** 開発時のホットリロードでもメモリ上のデータが消えないよう globalThis に置く */
const globalState = globalThis as unknown as { __barDirectory?: ShopDirectory; __barRepos?: Map<string, Repository> };

/** 店舗をまたいだ検索・店舗の作成 */
export function directory(): ShopDirectory {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return (globalState.__barDirectory ??= url && key ? new SupabaseDirectory(url, key) : new MemoryDirectory());
}

/** 指定した店舗のデータ */
export function shopRepository(shopId: string): Repository {
  const dir = directory();
  // 画面ごとに別々にまとめられるので instanceof ではなく形で見分ける（メモリ保存のとき）
  if ("repoFor" in dir) return (dir as MemoryDirectory).repoFor(shopId);
  const repos = (globalState.__barRepos ??= new Map());
  let repo = repos.get(shopId);
  if (!repo) {
    const encryptionKey = env("TOKEN_ENCRYPTION_KEY");
    if (!encryptionKey) throw new Error("TOKEN_ENCRYPTION_KEY が設定されていません");
    repo = new SupabaseRepository(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, encryptionKey, shopId);
    repos.set(shopId, repo);
  }
  return repo;
}

/** 今の処理の店舗（withShop で決めたもの、なければログイン中のセッション） */
export async function currentShopId(): Promise<string> {
  const fromContext = contextShopId();
  if (fromContext) return fromContext;
  const { currentSession } = await import("./auth");
  const session = await currentSession();
  if (!session) throw new Error("店舗が決まっていません（ログインしていません）");
  return session.shopId;
}

/**
 * 今の店舗のデータ。呼ぶたびに店舗を決めるので、画面やサーバーアクションでは店舗を意識せずに使える。
 * （メソッドはすべて非同期なので、呼ばれたときに店舗を調べてから本物に渡す）
 */
export function repository(): Repository {
  return new Proxy({} as Repository, {
    get(_target, prop) {
      // await されたときに Promise と間違われないように
      if (prop === "then") return undefined;
      return async (...args: unknown[]) => {
        const repo = shopRepository(await currentShopId()) as unknown as Record<PropertyKey, (...a: unknown[]) => unknown>;
        return repo[prop](...args);
      };
    },
  });
}

/** 月額の支払い（Stripe）。3つの値がそろったときだけ使う */
export function stripeConfig(): StripeConfig | null {
  const secretKey = env("STRIPE_SECRET_KEY");
  const priceId = env("STRIPE_PRICE_ID");
  const webhookSecret = env("STRIPE_WEBHOOK_SECRET");
  return secretKey && priceId && webhookSecret ? { secretKey, priceId, webhookSecret } : null;
}

/** 無料期間の日数（初期値14日） */
export function trialDays(): number {
  const days = Number(env("BILLING_TRIAL_DAYS") ?? 14);
  return Number.isFinite(days) && days >= 0 ? days : 14;
}

/** お店を使えるか（支払いの状態）。お店が止められている・見つからなければ locked */
export async function shopAccessFor(shopId: string, now = new Date()): Promise<Access> {
  const shop = await directory().getShop(shopId);
  if (!shop?.active) return "locked";
  return shopAccess(shop.billing, now, !!stripeConfig());
}

/** 今の店舗の公開URL（予約フォームなど）の土台。例: https://…/s/shop1 */
export async function shopPublicUrl(): Promise<string | null> {
  const base = appBaseUrl();
  if (!base) return null;
  const shop = await directory().getShop(await currentShopId());
  return shop ? `${base}/s/${shop.slug}` : null;
}

/** 今の店舗のSNS接続情報。店舗1は環境変数も使う（1店舗だったころの設定） */
export async function shopSecrets(): Promise<ShopSecrets> {
  const saved = await repository().getSecrets();
  if ((await currentShopId()) !== DEFAULT_SHOP_ID) return saved;
  return {
    lineChannelSecret: saved.lineChannelSecret || env("LINE_CHANNEL_SECRET"),
    lineChannelAccessToken: saved.lineChannelAccessToken || env("LINE_CHANNEL_ACCESS_TOKEN"),
    instagramAccessToken: saved.instagramAccessToken || env("INSTAGRAM_ACCESS_TOKEN"),
    instagramAppSecret: saved.instagramAppSecret || env("INSTAGRAM_APP_SECRET"),
    instagramVerifyToken: saved.instagramVerifyToken || env("INSTAGRAM_VERIFY_TOKEN"),
  };
}

/** 今の店舗のLINE公式アカウント（Messaging API） */
export async function lineClient(): Promise<LineClient | null> {
  const token = (await shopSecrets()).lineChannelAccessToken;
  return token ? new LineClient(token) : null;
}

/** 今の店舗のInstagram */
export async function instagramClient(): Promise<InstagramClient | null> {
  const token = (await shopSecrets()).instagramAccessToken;
  return token ? new InstagramClient(token, env("INSTAGRAM_API_BASE")) : null;
}

/** 店主への通知先（この店のLINE公式アカウントを友だち追加した店主のユーザーID） */
export async function ownerNotifyLineUserId(): Promise<string | undefined> {
  const { ownerNotifyLineUserId: id } = await repository().getSettings();
  if (id) return id;
  return (await currentShopId()) === DEFAULT_SHOP_ID ? env("OWNER_LINE_USER_ID") : undefined;
}

export function isMemoryMode(): boolean {
  return !(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));
}

function calendar(repo: Repository): CalendarSync {
  const config = googleOAuthConfig();
  if (!config) return noopCalendar;
  return new GoogleCalendarSync(config, () => repo.getGoogleIntegration(), appBaseUrl());
}

function messenger(): Messenger {
  return {
    async push(customer, text) {
      if (!canMessage(customer.channel) || !customer.externalId) {
        throw new Error("このお客様にはアプリから連絡できません。お電話でご連絡ください");
      }
      if (customer.channel === "line") {
        const line = await lineClient();
        if (!line) throw new Error("LINE公式アカウントが未接続です（設定 → SNSの接続）");
        await line.push(customer.externalId, text);
      } else if (customer.channel === "instagram") {
        const instagram = await instagramClient();
        if (!instagram) throw new Error("Instagramが未接続です（設定 → SNSの接続）");
        await instagram.send(customer.externalId, text);
      }
      // simulator はメッセージ履歴に残すだけ
    },
  };
}

/** 店主への通知（LINE）。通知先が未設定ならログに出すだけ */
export function notifier(): Notifier {
  return {
    async notify(text) {
      console.log(`[owner notification] ${text}`);
      const [line, owner] = await Promise.all([lineClient(), ownerNotifyLineUserId()]);
      if (line && owner) {
        try {
          await line.push(owner, text);
        } catch (error) {
          console.error("owner notification failed", error);
        }
      }
    },
  };
}

export function reservationService(): ReservationService {
  const repo = repository();
  const apiKey = env("ANTHROPIC_API_KEY");
  return new ReservationService({
    repo,
    extractor: apiKey ? new ClaudeExtractor(apiKey) : new RuleBasedExtractor(),
    calendar: calendar(repo),
    messenger: messenger(),
    notifier: notifier(),
  });
}

export async function promoService(): Promise<PromoService> {
  const service = reservationService();
  return new PromoService({
    repo: repository(),
    availabilityBoard: (date) => service.availabilityBoard(date),
    line: await lineClient(),
    instagram: await instagramClient(),
    notify: (text) => notifier().notify(text),
    baseUrl: appBaseUrl(),
    shopUrl: await shopPublicUrl(),
    shopId: await currentShopId(),
  });
}

export function salesService(): SalesService {
  return new SalesService(repository());
}
