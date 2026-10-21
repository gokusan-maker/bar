import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { repository } from "./container";
import { sign, verifySigned } from "./crypto";
import { authenticateStaff, canLogin } from "./staff-accounts";

const COOKIE = "bar_admin";
const SESSION_DAYS = 30;

type AuthMode = "password" | "open-dev" | "misconfigured";

/**
 * ADMIN_PASSWORD 未設定のときは、開発環境に限りログインなしで使えるようにする。
 * 本番で未設定なら管理画面は使えない。
 */
export function authMode(): AuthMode {
  if (process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET) return "password";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "open-dev";
}

export type Role = "owner" | "staff";

/** パスワードを変えたら、そのスタッフの古いログインが切れるようにするための目印 */
const fingerprint = (passwordHash: string) => createHash("sha256").update(passwordHash).digest("base64url").slice(0, 12);

export interface Session {
  role: Role;
  /** 自分のパスワードでログインしたスタッフの名前 */
  staffName: string | null;
}

/** ログイン中の権限。owner=店主（全操作）、staff=スタッフ（予約の閲覧と来店チェックのみ） */
export const currentSession = cache(async (): Promise<Session | null> => {
  const mode = authMode();
  if (mode === "open-dev") return { role: "owner", staffName: null };
  if (mode === "misconfigured") return null;
  const value = (await cookies()).get(COOKIE)?.value;
  const payload = verifySigned(value, process.env.SESSION_SECRET!);
  if (!payload) return null;
  const [role, exp, staffId, fp] = payload.split(":");
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  // 旧形式 "admin:..." は店主として扱う
  if (role === "owner" || role === "admin") return { role: "owner", staffName: null };
  if (role !== "staff") return null;
  if (!staffId) return process.env.STAFF_PASSWORD ? { role: "staff", staffName: null } : null;
  // 店主が在籍を外したり、パスワードを変えたりしたら、すぐにログインできなくなる
  const s = await repository().getStaff(staffId);
  if (!s || !canLogin(s) || fingerprint(s.passwordHash!) !== fp) return null;
  return { role: "staff", staffName: s.name };
});

export async function currentRole(): Promise<Role | null> {
  return (await currentSession())?.role ?? null;
}

/** 店主かどうか（店主専用の画面・操作・APIで使う） */
export async function isAdmin(): Promise<boolean> {
  return (await currentRole()) === "owner";
}

/** 店主専用の画面・サーバーアクションの先頭で呼ぶ */
export async function requireAdmin(): Promise<void> {
  const role = await currentRole();
  if (role === "owner") return;
  redirect(role === "staff" ? "/admin?forbidden=1" : "/login");
}

/** スタッフも使える画面・操作の先頭で呼ぶ */
export async function requireStaff(): Promise<Role> {
  const role = await currentRole();
  if (!role) redirect("/login");
  return role;
}

const matches = (input: string, expected: string | undefined) => {
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * 名前が空なら店主（ADMIN_PASSWORD）か共通のスタッフ用パスワード（STAFF_PASSWORD）、
 * 名前があればスタッフ本人のパスワードで確認する。
 */
export async function login(password: string, staffName = ""): Promise<boolean> {
  if (authMode() !== "password") return false;
  let payload: string | null = null;
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  if (staffName.trim()) {
    const s = await authenticateStaff(repository(), staffName, password);
    if (s) payload = `staff:${expiresAt}:${s.id}:${fingerprint(s.passwordHash!)}`;
  } else if (matches(password, process.env.ADMIN_PASSWORD)) {
    payload = `owner:${expiresAt}`;
  } else if (matches(password, process.env.STAFF_PASSWORD)) {
    payload = `staff:${expiresAt}`;
  }
  if (!payload) return false;
  (await cookies()).set(COOKIE, sign(payload, process.env.SESSION_SECRET!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
  return true;
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
