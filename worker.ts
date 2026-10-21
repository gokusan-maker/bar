// @ts-expect-error `.open-next/worker.js` は opennextjs-cloudflare build で生成される
import { default as handler } from "./.open-next/worker.js";

interface Env {
  CRON_SECRET?: string;
}

/** cron の時刻（UTC）→ 呼び出すアプリ内の定期処理 */
const JOBS: Record<string, string> = {
  "0 3 * * *": "/api/cron/reminders",
  "0 8 * * *": "/api/cron/evening",
};

const worker = {
  fetch: handler.fetch,

  /** Cloudflare の定期実行。アプリの cron 用 API を内部から呼ぶ */
  async scheduled(event: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const path = JOBS[event.cron];
    if (!path || !env.CRON_SECRET) {
      console.error(`cron skipped: ${event.cron}${env.CRON_SECRET ? "" : "（CRON_SECRET 未設定）"}`);
      return;
    }
    const req = new Request(`https://cron.internal${path}`, {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    });
    ctx.waitUntil(
      handler.fetch(req, env, ctx).then(async (res: Response) => {
        console.log(`cron ${path}: ${res.status} ${await res.text()}`);
      }),
    );
  },
};

export default worker;
