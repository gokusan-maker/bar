import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 32バイト鍵（任意の文字列から導出） */
const keyFrom = (secret: string) => createHash("sha256").update(secret).digest();

/** AES-256-GCMでトークン等を暗号化して "iv.tag.data"（base64url）で返す */
export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(token: string, secret: string): string {
  const [iv, tag, data] = token.split(".").map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** 改ざん防止の署名付き値 "payload.signature" */
export function sign(payload: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySigned(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const payload = value.slice(0, i);
  const expected = Buffer.from(sign(payload, secret).slice(i + 1));
  const actual = Buffer.from(value.slice(i + 1));
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? payload : null;
}
