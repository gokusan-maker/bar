import "server-only";
import { ClaudeExtractor } from "./extraction/claude";
import { RuleBasedExtractor } from "./extraction/rule-based";
import { GoogleCalendarSync, type GoogleOAuthConfig } from "./integrations/google-calendar";
import { InstagramClient } from "./integrations/instagram";
import { LineClient } from "./integrations/line";
import { noopCalendar, type CalendarSync, type Messenger, type Notifier } from "./ports";
import { canMessage } from "./domain/types";
import { MemoryRepository } from "./repo/memory";
import { SupabaseRepository } from "./repo/supabase";
import type { Repository } from "./repo/types";
import { ReservationService } from "./reservation-service";
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

export function lineClient(): LineClient | null {
  const token = env("LINE_CHANNEL_ACCESS_TOKEN");
  return token ? new LineClient(token) : null;
}

export function instagramClient(): InstagramClient | null {
  const token = env("INSTAGRAM_ACCESS_TOKEN");
  return token ? new InstagramClient(token, env("INSTAGRAM_API_BASE")) : null;
}

/** 開発時のホットリロードでもメモリ上のデータが消えないよう globalThis に置く */
const globalRepo = globalThis as unknown as { __barRepo?: Repository };

export function repository(): Repository {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (url && key) {
    const encryptionKey = env("TOKEN_ENCRYPTION_KEY");
    if (!encryptionKey) throw new Error("TOKEN_ENCRYPTION_KEY が設定されていません");
    return (globalRepo.__barRepo ??= new SupabaseRepository(url, key, encryptionKey));
  }
  return (globalRepo.__barRepo ??= new MemoryRepository());
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
  const line = lineClient();
  const instagram = instagramClient();
  return {
    async push(customer, text) {
      if (!canMessage(customer.channel) || !customer.externalId) {
        throw new Error("このお客様にはアプリから連絡できません。お電話でご連絡ください");
      }
      if (customer.channel === "line") {
        if (!line) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が未設定です");
        await line.push(customer.externalId, text);
      } else if (customer.channel === "instagram") {
        if (!instagram) throw new Error("INSTAGRAM_ACCESS_TOKEN が未設定です");
        await instagram.send(customer.externalId, text);
      }
      // simulator はメッセージ履歴に残すだけ
    },
  };
}

/** 店主への通知（LINE）。OWNER_LINE_USER_ID がなければログに出すだけ */
export function notifier(): Notifier {
  const line = lineClient();
  const owner = env("OWNER_LINE_USER_ID");
  return {
    async notify(text) {
      console.log(`[owner notification] ${text}`);
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

export function salesService(): SalesService {
  return new SalesService(repository());
}
