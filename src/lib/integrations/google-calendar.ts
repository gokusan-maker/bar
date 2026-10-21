import "server-only";
import type { Interval } from "../domain/availability";
import { fromJst } from "../domain/time";
import { CHANNEL_LABEL, type GoogleIntegration, type Reservation, type ShopSettings } from "../domain/types";
import type { CalendarSync } from "../ports";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // 毎回 refresh_token を受け取るため
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Google token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
): Promise<{ refreshToken: string; email: string | null }> {
  const token = await tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  if (!token.refresh_token) throw new Error("Googleから refresh_token が返されませんでした");
  let email: string | null = null;
  if (token.id_token) {
    // トークンエンドポイントから直接受け取ったものなので署名検証は省略して中身だけ読む
    const payload = JSON.parse(Buffer.from(token.id_token.split(".")[1], "base64url").toString());
    email = payload.email ?? null;
  }
  return { refreshToken: token.refresh_token, email };
}

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(config: GoogleOAuthConfig, refreshToken: string): Promise<string> {
  const cached = accessTokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const token = await tokenRequest({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  accessTokenCache.set(refreshToken, {
    token: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  });
  return token.access_token;
}

class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(
  config: GoogleOAuthConfig,
  integration: GoogleIntegration,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await accessToken(config, integration.refreshToken);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    throw new GoogleApiError(res.status, `Google Calendar ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function listCalendars(
  config: GoogleOAuthConfig,
  integration: GoogleIntegration,
): Promise<{ id: string; summary: string; primary: boolean }[]> {
  const res = await api<{ items: { id: string; summary: string; primary?: boolean; accessRole: string }[] }>(
    config,
    integration,
    "/users/me/calendarList?minAccessRole=writer",
  );
  return res.items.map((c) => ({ id: c.id, summary: c.summary, primary: !!c.primary }));
}

interface CalendarEvent {
  id: string;
  status?: string;
  transparency?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

const STATUS_LABEL: Partial<Record<Reservation["status"], string>> = {
  pending: "【仮予約】",
  confirmed: "【予約】",
};
// Googleカレンダーの色ID: 5=黄（仮）, 10=緑（確定）
const STATUS_COLOR: Partial<Record<Reservation["status"], string>> = { pending: "5", confirmed: "10" };

export function eventBody(r: Reservation, settings: ShopSettings, adminBaseUrl: string | null) {
  const channel = CHANNEL_LABEL[r.channel];
  const lines = [
    `人数: ${r.partySize}名`,
    `受付: ${channel}`,
    r.notes ? `要望: ${r.notes}` : null,
    adminBaseUrl ? `管理画面: ${adminBaseUrl}/admin/reservations/${r.id}` : null,
  ].filter(Boolean);
  return {
    summary: `${STATUS_LABEL[r.status] ?? ""}${r.name}様 ${r.partySize}名`,
    description: lines.join("\n"),
    location: settings.shopName,
    start: { dateTime: r.startAt, timeZone: "Asia/Tokyo" },
    end: { dateTime: r.endAt, timeZone: "Asia/Tokyo" },
    colorId: STATUS_COLOR[r.status],
    extendedProperties: { private: { reservationId: r.id } },
  };
}

/**
 * 終日の予定は「その日の営業（朝6時〜翌朝6時）」を塞ぐものとして扱う。
 * 予約アプリが作った予定（reservationId付き）と「予定なし」表示の予定は除外する。
 */
export function eventsToBlocks(events: CalendarEvent[]): Interval[] {
  return events.flatMap((e) => {
    if (e.status === "cancelled" || e.transparency === "transparent") return [];
    if (e.extendedProperties?.private?.reservationId) return [];
    if (e.start.dateTime && e.end.dateTime) {
      return [{ start: new Date(e.start.dateTime), end: new Date(e.end.dateTime) }];
    }
    if (e.start.date && e.end.date) {
      return [{ start: fromJst(e.start.date, "06:00"), end: fromJst(e.end.date, "06:00") }];
    }
    return [];
  });
}

export class GoogleCalendarSync implements CalendarSync {
  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly loadIntegration: () => Promise<GoogleIntegration | null>,
    private readonly adminBaseUrl: string | null,
  ) {}

  async upsert(r: Reservation, settings: ShopSettings): Promise<string | null> {
    const integration = await this.loadIntegration();
    if (!integration) return null;
    const cal = encodeURIComponent(integration.calendarId);
    const body = JSON.stringify(eventBody(r, settings, this.adminBaseUrl));
    if (r.googleEventId) {
      try {
        const ev = await api<CalendarEvent>(
          this.config,
          integration,
          `/calendars/${cal}/events/${encodeURIComponent(r.googleEventId)}`,
          { method: "PATCH", body },
        );
        // カレンダー側で削除済み（cancelled）の予定は作り直す
        if (ev.status !== "cancelled") return ev.id;
      } catch (error) {
        if (!(error instanceof GoogleApiError) || (error.status !== 404 && error.status !== 410)) throw error;
      }
    }
    const ev = await api<CalendarEvent>(this.config, integration, `/calendars/${cal}/events`, {
      method: "POST",
      body,
    });
    return ev.id;
  }

  async remove(r: Reservation): Promise<void> {
    const integration = await this.loadIntegration();
    if (!integration || !r.googleEventId) return;
    try {
      await api(
        this.config,
        integration,
        `/calendars/${encodeURIComponent(integration.calendarId)}/events/${encodeURIComponent(r.googleEventId)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return;
      throw error;
    }
  }

  async getEvent(eventId: string): Promise<Interval | "deleted" | null> {
    const integration = await this.loadIntegration();
    if (!integration) return null;
    try {
      const ev = await api<CalendarEvent>(
        this.config,
        integration,
        `/calendars/${encodeURIComponent(integration.calendarId)}/events/${encodeURIComponent(eventId)}`,
      );
      if (ev.status === "cancelled") return "deleted";
      if (!ev.start.dateTime || !ev.end.dateTime) return null;
      return { start: new Date(ev.start.dateTime), end: new Date(ev.end.dateTime) };
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return "deleted";
      throw error;
    }
  }

  async busyBlocks(from: Date, to: Date): Promise<Interval[]> {
    const integration = await this.loadIntegration();
    if (!integration) return [];
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      maxResults: "250",
    });
    const res = await api<{ items: CalendarEvent[] }>(
      this.config,
      integration,
      `/calendars/${encodeURIComponent(integration.calendarId)}/events?${params}`,
    );
    return eventsToBlocks(res.items);
  }
}
