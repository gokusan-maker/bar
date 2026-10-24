import "server-only";

/** LINEログイン（Messaging API とは別の「LINEログイン」チャネル） */
export interface LineLoginConfig {
  channelId: string;
  channelSecret: string;
  redirectUri: string;
}

export function lineLoginAuthorizeUrl(config: LineLoginConfig, state: string, nonce: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: config.channelId,
    redirect_uri: config.redirectUri,
    state,
    nonce,
    scope: "profile openid",
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${q}`;
}

/** 認可コードをトークンに替え、IDトークンをLINEのサーバーで確かめて、ユーザーIDと表示名を返す */
export async function lineLoginExchange(config: LineLoginConfig, code: string, nonce: string): Promise<{ userId: string; name: string }> {
  const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.channelId,
      client_secret: config.channelSecret,
    }),
  });
  if (!tokenRes.ok) throw new Error(`LINE login token ${tokenRes.status} ${await tokenRes.text()}`);
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) throw new Error("LINE login: id_token がありません（scope に openid が必要）");

  // 署名・有効期限・送り先（client_id）・nonce の確認はLINEの検証APIに任せる
  const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token, client_id: config.channelId, nonce }),
  });
  if (!verifyRes.ok) throw new Error(`LINE login verify ${verifyRes.status} ${await verifyRes.text()}`);
  const claims = (await verifyRes.json()) as { sub?: string; name?: string };
  if (!claims.sub) throw new Error("LINE login: ユーザーIDが取れませんでした");
  return { userId: claims.sub, name: claims.name ?? "" };
}
