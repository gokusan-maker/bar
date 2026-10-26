import "server-only";
import { sign, verifySigned } from "./crypto";

/**
 * お客様が自分の予約を確認・キャンセルするリンクの文字列（店舗と予約を署名したもの）。
 * 推測も書き換えもできないので、DBに合言葉を持たなくてよい。
 */
export function guestReservationToken(shopId: string, reservationId: string): string {
  return sign(`${shopId}~${reservationId}`, secret());
}

export function readGuestReservationToken(token: string): { shopId: string; reservationId: string } | null {
  const payload = verifySigned(token, secret());
  if (!payload) return null;
  const [shopId, reservationId] = payload.split("~");
  return shopId && reservationId ? { shopId, reservationId } : null;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  // 開発環境（SESSION_SECRET なし）でも動くように
  return s ? `guest:${s}` : "dev-guest-secret";
}
