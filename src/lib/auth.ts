import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sign, verifySigned } from "./crypto";

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

/** ログイン中の権限。owner=店主（全操作）、staff=スタッフ（予約の閲覧と来店チェックのみ） */
export async function currentRole(): Promise<Role | null> {
  const mode = authMode();
  if (mode === "open-dev") return "owner";
  if (mode === "misconfigured") return null;
  const value = (await cookies()).get(COOKIE)?.value;
  const payload = verifySigned(value, process.env.SESSION_SECRET!);
  if (!payload) return null;
  const [role, exp] = payload.split(":");
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  // 旧形式 "admin:..." は店主として扱う
  if (role === "owner" || role === "admin") return "owner";
  if (role === "staff" && process.env.STAFF_PASSWORD) return "staff";
  return null;
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

export async function login(password: string): Promise<boolean> {
  if (authMode() !== "password") return false;
  const role: Role | null = matches(password, process.env.ADMIN_PASSWORD)
    ? "owner"
    : matches(password, process.env.STAFF_PASSWORD)
      ? "staff"
      : null;
  if (!role) return false;
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  (await cookies()).set(COOKIE, sign(`${role}:${expiresAt}`, process.env.SESSION_SECRET!), {
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
