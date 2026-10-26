import "server-only";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

// Cloudflare Workers の無料プランは1リクエストのCPU時間が短いため回数を控えめにしている。
// 回数はハッシュに記録するので、あとから増やしても既存のパスワードはそのまま使える。
const ITERATIONS = 20_000;

/** "pbkdf2-sha256$回数$salt$hash"（base64url） */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  return ["pbkdf2-sha256", ITERATIONS, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export function verifyPassword(password: string, stored: string | null): boolean {
  const [scheme, iter, salt, hash] = (stored ?? "").split("$");
  const iterations = Number(iter);
  if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations <= 0 || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = pbkdf2Sync(password, Buffer.from(salt, "base64url"), iterations, expected.length, "sha256");
  return timingSafeEqual(actual, expected);
}
