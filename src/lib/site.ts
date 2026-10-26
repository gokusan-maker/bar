/** 運営者の表示（プライバシーポリシー・利用規約・お問い合わせ） */
export function siteInfo() {
  return {
    appName: process.env.APP_NAME?.trim() || "バー予約・集客アプリ",
    operatorName: process.env.OPERATOR_NAME?.trim() || "本アプリの運営者",
    contactEmail: process.env.CONTACT_EMAIL?.trim() || null,
  };
}
