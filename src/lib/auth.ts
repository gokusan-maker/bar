import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { directory, shopRepository } from "./container";
import { sign, verifySigned } from "./crypto";
import { DEFAULT_SHOP_ID, type Staff } from "./domain/types";
import { verifyPassword } from "./password";
import { authenticateStaff, canLogin, normalizeLoginId } from "./staff-accounts";

const COOKIE = "bar_admin";
const SESSION_DAYS = 30;

type AuthMode = "password" | "open-dev" | "misconfigured";

/**
 * SESSION_SECRET 未設定のときは、開発環境に限りログインなしで（店舗1のオーナーとして）使えるようにする。
 * 本番で未設定なら管理画面は使えない。
 */
export function authMode(): AuthMode {
  if (process.env.SESSION_SECRET) return "password";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "open-dev";
}

export type Role = "owner" | "staff";

/** パスワードやLINEの連携を変えたら、その人の古いログインが切れるようにするための目印 */
const fingerprint = (s: Pick<Staff, "passwordHash" | "lineUserId">) =>
  createHash("sha256")
    .update(`${s.passwordHash ?? ""}|${s.lineUserId ?? ""}`)
    .digest("base64url")
    .slice(0, 12);

export interface Session {
  role: Role;
  shopId: string;
  /** 自分のアカウント（ID・LINE）でログインした人。店舗1の旧オーナー・共通パスワードのときは null */
  memberId: string | null;
  /** スタッフ本人のアカウントのとき（オーナーは null） */
  staffId: string | null;
  staffName: string | null;
}

/** 店舗1の旧オーナー（ADMIN_PASSWORD）がLINEでログインできるLINEユーザーID */
export async function ownerLineUserIds(): Promise<string[]> {
  const fromEnv = process.env.OWNER_LINE_USER_ID?.trim();
  const { ownerLineUserIds } = await shopRepository(DEFAULT_SHOP_ID).getSettings();
  return [...new Set([...(ownerLineUserIds ?? []), ...(fromEnv ? [fromEnv] : [])])];
}

/** 店舗1の旧オーナーのログインID（ほかの人が同じIDを使えないようにする） */
export async function reservedLoginIds(): Promise<string[]> {
  if (!process.env.ADMIN_PASSWORD) return [];
  const { ownerLoginId } = await shopRepository(DEFAULT_SHOP_ID).getSettings();
  return [normalizeLoginId(ownerLoginId || "admin")];
}

const legacyOwner = (): Session => ({ role: "owner", shopId: DEFAULT_SHOP_ID, memberId: null, staffId: null, staffName: null });

/** ログイン中の人と店舗。owner=オーナー（店のすべて）、staff=スタッフ（集客・売上の入力・お客様情報・予約・注文） */
export const currentSession = cache(async (): Promise<Session | null> => {
  const mode = authMode();
  if (mode === "open-dev") return legacyOwner();
  if (mode === "misconfigured") return null;
  const value = (await cookies()).get(COOKIE)?.value;
  const payload = verifySigned(value, process.env.SESSION_SECRET!);
  if (!payload) return null;
  const parts = payload.split(":");
  const [kind, exp] = parts;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  // 自分のアカウント（オーナー・スタッフ）
  if (kind === "m") {
    const [, , shopId, memberId, fp] = parts;
    const shop = await directory().getShop(shopId);
    if (!shop?.active) return null;
    const m = await shopRepository(shopId).getStaff(memberId);
    // 在籍を外す・パスワードやLINEの連携を変える・ログインを止めると、すぐにログインできなくなる
    if (!m || !canLogin(m) || fingerprint(m) !== fp) return null;
    return m.role === "owner"
      ? { role: "owner", shopId, memberId: m.id, staffId: null, staffName: m.name }
      : { role: "staff", shopId, memberId: m.id, staffId: m.id, staffName: m.name };
  }

  // ここから下は、1店舗だったころのログイン（店舗1）
  if (kind === "owner" || kind === "admin") return process.env.ADMIN_PASSWORD ? legacyOwner() : null;
  if (kind === "owner-line") return (await ownerLineUserIds()).includes(parts[2]) ? legacyOwner() : null;
  if (kind !== "staff") return null;
  const [, , staffId, fp] = parts;
  if (!staffId) {
    return process.env.STAFF_PASSWORD
      ? { role: "staff", shopId: DEFAULT_SHOP_ID, memberId: null, staffId: null, staffName: null }
      : null;
  }
  const s = await shopRepository(DEFAULT_SHOP_ID).getStaff(staffId);
  if (!s || !canLogin(s) || fingerprint(s) !== fp) return null;
  return { role: "staff", shopId: DEFAULT_SHOP_ID, memberId: s.id, staffId: s.id, staffName: s.name };
});

/** 操作履歴に残す「誰が」。自分のアカウントなら名前も */
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

/** Cookie の中身は "種類:有効期限:..."（例: m:<期限>:<店舗>:<人>:<目印>） */
async function startSession(kind: string, ...rest: string[]) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  (await cookies()).set(COOKIE, sign([kind, String(expiresAt), ...rest].join(":"), process.env.SESSION_SECRET!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

/** 自分のアカウントでログインした状態にする */
export async function startMemberSession(shopId: string, m: Staff) {
  await startSession("m", shopId, m.id, fingerprint(m));
}

/** オーナーのログイン：自分のアカウント（ログインID＋パスワード）か、店舗1の旧オーナー（ID＋ADMIN_PASSWORD） */
export async function loginOwner(loginId: string, password: string): Promise<boolean> {
  if (authMode() !== "password") return false;
  const id = normalizeLoginId(loginId);
  const found = await directory().findMemberByLoginId(id);
  if (found?.member.role === "owner" && canLogin(found.member) && verifyPassword(password, found.member.passwordHash)) {
    if (!(await directory().getShop(found.shopId))?.active) return false;
    await startMemberSession(found.shopId, found.member);
    return true;
  }
  const { ownerLoginId } = await shopRepository(DEFAULT_SHOP_ID).getSettings();
  // IDが違ってもパスワードの照合はして、どちらが違うか分からないようにする
  if (!matches(password, process.env.ADMIN_PASSWORD) || id !== normalizeLoginId(ownerLoginId || "admin")) return false;
  await startSession("owner");
  return true;
}

/** スタッフのログイン：ログインID＋本人のパスワード。店舗1は名前・共通の STAFF_PASSWORD も使える */
export async function loginStaff(password: string, idOrName: string): Promise<boolean> {
  if (authMode() !== "password") return false;
  if (idOrName.trim()) {
    const found = await directory().findMemberByLoginId(normalizeLoginId(idOrName));
    if (found) {
      const m = found.member;
      if (m.role !== "staff" || !canLogin(m) || !verifyPassword(password, m.passwordHash)) return false;
      if (!(await directory().getShop(found.shopId))?.active) return false;
      await startMemberSession(found.shopId, m);
      return true;
    }
    // ID導入前に名前で登録した店舗1のスタッフ
    const s = await authenticateStaff(shopRepository(DEFAULT_SHOP_ID), idOrName, password);
    if (!s) return false;
    await startMemberSession(DEFAULT_SHOP_ID, s);
    return true;
  }
  if (!matches(password, process.env.STAFF_PASSWORD)) return false;
  await startSession("staff");
  return true;
}

/** LINEでのログイン（LINEログインの確認が済んだユーザーID） */
export async function loginWithLine(lineUserId: string, as: Role): Promise<"ok" | "pending" | "unlinked"> {
  if (authMode() !== "password") return "unlinked";
  const found = await directory().findMemberByLineUserId(lineUserId);
  if (found && found.member.role === as) {
    if (found.member.pending) return "pending";
    if (!canLogin(found.member) || !(await directory().getShop(found.shopId))?.active) return "unlinked";
    await startMemberSession(found.shopId, found.member);
    return "ok";
  }
  if (as === "owner" && (await ownerLineUserIds()).includes(lineUserId)) {
    await startSession("owner-line", lineUserId);
    return "ok";
  }
  return "unlinked";
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
