/** 「LINEでログイン」ボタン（LINEの決まりに沿った緑のボタン） */
export function LineLoginButton({ purpose, code, label = "LINEでログイン" }: { purpose: string; code?: string; label?: string }) {
  const q = new URLSearchParams({ purpose, ...(code ? { code } : {}) });
  return (
    <a className="button line-button" href={`/api/line-login/start?${q}`} style={{ width: "100%", justifyContent: "center" }}>
      {label}
    </a>
  );
}

export const LOGIN_ERRORS: Record<string, string> = {
  "1": "名前かパスワードが違います",
  locked: "ログインの失敗が続いたため、しばらく（15分ほど）ログインできません。",
  line_off: "LINEログインが設定されていません（LINE_LOGIN_CHANNEL_ID・LINE_LOGIN_CHANNEL_SECRET）。",
  line_state: "LINEログインの時間が切れました。もう一度お試しください。",
  line_failed: "LINEログインに失敗しました。もう一度お試しください。",
  line_unlinked: "このLINEはまだ登録されていません。",
  pending: "店主の承認がまだです。承認されるとログインできます。",
  relogin: "パスワードを変えました。新しいパスワードでログインしてください。",
};
