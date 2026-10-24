import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { repository } from "./container";
import { sign, verifySigned } from "./crypto";
import type { Staff } from "./domain/types";
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

/** パスワードやLINEの連携を変えたら、そのスタッフの古いログインが切れるようにするための目印 */
const fingerprint = (s: Pick<Staff, "passwordHash" | "lineUserId">) =>
  createHash("sha256")
    .update(`${s.passwordHash ?? ""}|${s.lineUserId ?? ""}`)
    .digest("base64url")
    .slice(0, 12);

export interface Session {
  role: Role;
  /** 自分のアカウント（パスワード・LINE）でログインしたスタッフ */
  staffId: string | null;
  staffName: string | null;
}

/** LINEでログインできる店主のLINEユーザーID */
export async function ownerLineUserIds(): Promise<string[]> {
  const fromEnv = process.env.OWNER_LINE_USER_ID?.trim();
  const { ownerLineUserIds } = await repository().getSettings();
  return [...new Set([...(ownerLineUserIds ?? []), ...(fromEnv ? [fromEnv] : [])])];
}

/** ログイン中の権限。owner=店主（全操作）、staff=スタッフ（集客・売上の入力・お客様情報・予約の確認と来店チェック） */
export const currentSession = cache(async (): Promise<Session | null> => {
  const mode = authMode();
  if (mode === "open-dev") return { role: "owner", staffId: null, staffName: null };
  if (mode === "misconfigured") return null;
  const value = (await cookies()).get(COOKIE)?.value;
  const payload = verifySigned(value, process.env.SESSION_SECRET!);
  if (!payload) return null;
  const [role, exp, id, fp] = payload.split(":");
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  // 旧形式 "admin:..." は店主として扱う
  if (role === "owner" || role === "admin") return { role: "owner", staffId: null, staffName: null };
  // LINEでログインした店主。連携を外したらログインできなくなる
  if (role === "owner-line") return (await ownerLineUserIds()).includes(id) ? { role: "owner", staffId: null, staffName: null } : null;
  if (role !== "staff") return null;
  if (!id) return process.env.STAFF_PASSWORD ? { role: "staff", staffId: null, staffName: null } : null;
  // 店主が在籍を外したり、パスワード・LINEの連携を変えたりしたら、すぐにログインできなくなる
  const s = await repository().getStaff(id);
  if (!s || !canLogin(s) || fingerprint(s) !== fp) return null;
  return { role: "staff", staffId: s.id, staffName: s.name };
});

/** 操作履歴に残す「誰が」。スタッフ本人のアカウントなら名前も */
export async function currentActor(): Promise<{ actor: Role; name: string | null }> {
  const s = await currentSession();
  return { actor: s?.role ?? "owner", name: s?.staffName ?? null };
}

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
  redirect(role === "staff" ? "/admin?forbidden=1" : "/owner/login");
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

async function startSession(payload: string, expiresAt: number) {
  (await cookies()).set(COOKIE, sign(payload, process.env.SESSION_SECRET!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

const sessionExpiry = () => Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

/** 店主のログイン画面：ADMIN_PASSWORD だけを受け付ける */
export async function loginOwner(password: string): Promise<boolean> {
  if (authMode() !== "password" || !matches(password, process.env.ADMIN_PASSWORD)) return false;
  const expiresAt = sessionExpiry();
  await startSession(`owner:${expiresAt}`, expiresAt);
  return true;
}

/** スタッフのログイン画面：名前があれば本人のパスワード、空なら共通の STAFF_PASSWORD */
export async function loginStaff(password: string, staffName: string): Promise<boolean> {
  if (authMode() !== "password") return false;
  const expiresAt = sessionExpiry();
  if (staffName.trim()) {
    const s = await authenticateStaff(repository(), staffName, password);
    if (!s) return false;
    await startSession(`staff:${expiresAt}:${s.id}:${fingerprint(s)}`, expiresAt);
    return true;
  }
  if (!matches(password, process.env.STAFF_PASSWORD)) return false;
  await startSession(`staff:${expiresAt}`, expiresAt);
  return true;
}

/** LINEでのログイン（LINEログインの確認が済んだユーザーID） */
export async function loginWithLine(lineUserId: string, as: Role): Promise<"ok" | "pending" | "unlinked"> {
  if (authMode() !== "password") return "unlinked";
  const expiresAt = sessionExpiry();
  if (as === "owner") {
    if (!(await ownerLineUserIds()).includes(lineUserId)) return "unlinked";
    await startSession(`owner-line:${expiresAt}:${lineUserId}`, expiresAt);
    return "ok";
  }
  const s = (await repository().listStaff()).find((x) => x.lineUserId === lineUserId);
  if (!s) return "unlinked";
  if (s.pending) return "pending";
  if (!canLogin(s)) return "unlinked";
  await startSession(`staff:${expiresAt}:${s.id}:${fingerprint(s)}`, expiresAt);
  return "ok";
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
