import "server-only";
import { randomBytes } from "node:crypto";
import { sign, verifySigned } from "./crypto";

/** LINEログインの目的。ログイン（店主・スタッフ）、自分のアカウントへの連携、招待リンクからの登録 */
export type LineLoginPurpose = "owner" | "staff" | "link-owner" | "link-staff" | "join";
export const LINE_LOGIN_PURPOSES: LineLoginPurpose[] = ["owner", "staff", "link-owner", "link-staff", "join"];

export const LINE_STATE_COOKIE = "bar_line_login";
const TTL_MS = 10 * 60 * 1000;

export interface LineLoginState {
  state: string;
  nonce: string;
  purpose: LineLoginPurpose;
  /** join のときの招待コード */
  code?: string;
  exp: number;
}

export function newLineLoginState(purpose: LineLoginPurpose, code?: string): LineLoginState {
  return {
    state: randomBytes(16).toString("base64url"),
    nonce: randomBytes(16).toString("base64url"),
    purpose,
    ...(code ? { code } : {}),
    exp: Date.now() + TTL_MS,
  };
}

export const encodeLineLoginState = (s: LineLoginState, secret: string) =>
  sign(Buffer.from(JSON.stringify(s)).toString("base64url"), secret);

/** Cookieの値を確かめ、LINEから戻ってきた state と一致すれば返す */
export function decodeLineLoginState(cookie: string | undefined, returnedState: string | null, secret: string): LineLoginState | null {
  const payload = verifySigned(cookie, secret);
  if (!payload || !returnedState) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as LineLoginState;
    if (s.exp < Date.now() || s.state !== returnedState || !LINE_LOGIN_PURPOSES.includes(s.purpose)) return null;
    return s;
  } catch {
    return null;
  }
}
