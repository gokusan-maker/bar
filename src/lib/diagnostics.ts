import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { authMode } from "./auth";
import { appBaseUrl, googleOAuthConfig, instagramClient, lineClient, repository } from "./container";
import { listCalendars } from "./integrations/google-calendar";
import { DB_SCHEMA, EVIDENCE_BUCKET, supabaseClient } from "./repo/supabase";

export interface Check {
  name: string;
  status: "ok" | "warn" | "error" | "off";
  detail: string;
}

/** テーブルと、それを作るSQLファイル */
/** [表, 作成するSQL, 確認する列（追加の列だけのSQLもあるため）] */
const TABLES: [string, string, string?][] = [
  ["reservations", "20261020000000_init.sql"],
  ["sales", "20261021000000_sales.sql"],
  ["audit_logs", "20261022000000_audit.sql"],
  ["login_failures", "20261023000000_privacy.sql"],
  ["web_requests", "20261024000000_web_booking.sql"],
  ["staff", "20261027000000_staff_login.sql", "password_hash"],
];

/** よくある失敗を、店主にわかる言葉にする */
export function explainError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number })?.status ?? Number(/\b(40[13]|404)\b/.exec(raw)?.[1]);
  if (status === 401 || status === 403 || /invalid_grant|unauthorized|authentication/i.test(raw)) {
    return "認証に失敗しました。キー・トークンが正しいか、期限切れでないか確認してください";
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(raw)) return "サービスに接続できませんでした。時間をおいて再確認してください";
  return raw.slice(0, 200);
}

async function safe(name: string, fn: () => Promise<Check>): Promise<Check> {
  try {
    return await fn();
  } catch (e) {
    return { name, status: "error", detail: explainError(e) };
  }
}

/** 本番の各サービスにつながっているかを確認する（無料の確認用APIだけを使う） */
export async function runDiagnostics(): Promise<Check[]> {
  const env = (k: string) => !!process.env[k]?.trim();
  const checks: Promise<Check>[] = [];

  checks.push(
    Promise.resolve<Check>(
      authMode() === "password"
        ? { name: "管理画面のログイン", status: "ok", detail: env("STAFF_PASSWORD") ? "店主・スタッフ用パスワード設定済み" : "店主用パスワード設定済み（スタッフ用は未設定）" }
        : { name: "管理画面のログイン", status: "error", detail: "ADMIN_PASSWORD と SESSION_SECRET を設定してください" },
    ),
  );

  const base = appBaseUrl();
  checks.push(
    Promise.resolve<Check>(
      !base
        ? { name: "公開URL（APP_BASE_URL）", status: "error", detail: "未設定です。Googleカレンダー連携と予約フォームのURLに必要です" }
        : base.startsWith("https://")
          ? { name: "公開URL（APP_BASE_URL）", status: "ok", detail: base }
          : { name: "公開URL（APP_BASE_URL）", status: "warn", detail: `${base}（本番は https:// にしてください）` },
    ),
  );

  checks.push(
    safe("データベース（Supabase）", async () => {
      const url = process.env.SUPABASE_URL?.trim();
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
      if (!url || !key) return { name: "データベース（Supabase）", status: "warn", detail: "未接続（メモリ保存。再起動でデータが消えます）" };
      if (!env("TOKEN_ENCRYPTION_KEY")) return { name: "データベース（Supabase）", status: "error", detail: "TOKEN_ENCRYPTION_KEY が未設定です" };
      const db = supabaseClient(url, key);
      const missing: string[] = [];
      for (const [table, file, column] of TABLES) {
        const { error } = await db.from(table).select(column ?? "*", { count: "exact", head: true });
        // bar スキーマがAPIに公開されていないと、どの表も読めない
        if (error?.code === "PGRST106") {
          return { name: "データベース（Supabase）", status: "error", detail: `Supabaseの Project Settings → Data API → Exposed schemas に「${DB_SCHEMA}」を追加してください` };
        }
        if (error?.code === "42501") {
          return { name: "データベース（Supabase）", status: "error", detail: "表を読む権限がありません。20261026000000_grants.sql を実行してください" };
        }
        if (error) missing.push(file);
      }
      const bucket = await db.storage.getBucket(EVIDENCE_BUCKET);
      if (missing.length) return { name: "データベース（Supabase）", status: "error", detail: `未実行のSQLがあります: ${missing.join("、")}` };
      if (bucket.error) return { name: "データベース（Supabase）", status: "error", detail: `証拠写真の保存先（${EVIDENCE_BUCKET} バケット）がありません` };
      return { name: "データベース（Supabase）", status: "ok", detail: "接続OK・テーブルと写真の保存先あり" };
    }),
  );

  checks.push(
    safe("メッセージの読み取り（Claude API）", async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) return { name: "メッセージの読み取り（Claude API）", status: "warn", detail: "未設定（無料の簡易読み取りで動作中。設定するとAIで読み取り精度が上がります。料金はAPIの利用量に応じて発生）" };
      // モデル情報の取得は課金されない
      const model = await new Anthropic({ apiKey }).models.retrieve("claude-opus-5-5");
      return { name: "メッセージの読み取り（Claude API）", status: "ok", detail: `APIキー有効（${model.display_name}）` };
    }),
  );

  checks.push(
    safe("LINE公式アカウント", async () => {
      const client = lineClient();
      if (!client || !env("LINE_CHANNEL_SECRET")) {
        return { name: "LINE公式アカウント", status: "off", detail: "未設定（LINE_CHANNEL_SECRET・LINE_CHANNEL_ACCESS_TOKEN）" };
      }
      const name = await client.botName();
      return env("OWNER_LINE_USER_ID")
        ? { name: "LINE公式アカウント", status: "ok", detail: `${name}・店主への通知先あり` }
        : { name: "LINE公式アカウント", status: "warn", detail: `${name}（OWNER_LINE_USER_ID 未設定のため店主に通知が届きません）` };
    }),
  );

  checks.push(
    safe("Instagram", async () => {
      const client = instagramClient();
      if (!client || !env("INSTAGRAM_APP_SECRET")) return { name: "Instagram", status: "off", detail: "未設定（使わない場合はこのままで問題ありません）" };
      const username = await client.me();
      return env("INSTAGRAM_VERIFY_TOKEN")
        ? { name: "Instagram", status: "ok", detail: `@${username}` }
        : { name: "Instagram", status: "warn", detail: `@${username}（INSTAGRAM_VERIFY_TOKEN 未設定のためWebhookを登録できません）` };
    }),
  );

  checks.push(
    safe("Googleカレンダー", async () => {
      const config = googleOAuthConfig();
      if (!config) return { name: "Googleカレンダー", status: "off", detail: "未設定（GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET・APP_BASE_URL）" };
      const integration = await repository().getGoogleIntegration();
      if (!integration) return { name: "Googleカレンダー", status: "warn", detail: "設定画面から連携してください" };
      const calendars = await listCalendars(config, integration);
      const target = calendars.find((c) => (c.primary ? "primary" : c.id) === integration.calendarId || c.id === integration.calendarId);
      return target
        ? { name: "Googleカレンダー", status: "ok", detail: `「${target.summary}」に書き込み` }
        : { name: "Googleカレンダー", status: "error", detail: "選んだカレンダーが見つかりません。設定画面で選び直してください" };
    }),
  );

  checks.push(
    Promise.resolve<Check>(
      env("CRON_SECRET")
        ? { name: "自動処理（リマインド・17時の通知など）", status: "ok", detail: "CRON_SECRET 設定済み" }
        : { name: "自動処理（リマインド・17時の通知など）", status: "error", detail: "CRON_SECRET が未設定のため、自動処理が動きません" },
    ),
  );

  return Promise.all(checks);
}
