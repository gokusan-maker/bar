import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Staff } from "./domain/types";
import { hashPassword, verifyPassword } from "./password";
import type { Repository } from "./repo/types";

export const MIN_PASSWORD_LENGTH = 8;
/** いたずらで申請が溜まらないように、承認待ちはこの人数まで */
export const MAX_PENDING = 10;

/** 全角・半角や前後・途中の空白の違いを無視して名前を比べる */
export const normalizeStaffName = (name: string) => name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

export const newInviteCode = () => randomBytes(16).toString("base64url");

function sameCode(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return !!expected && a.length === b.length && timingSafeEqual(a, b);
}

export async function isValidInviteCode(repo: Repository, code: string): Promise<boolean> {
  return sameCode(code, (await repo.getSettings()).staffInviteCode);
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`;
  if (password.length > 100) return "パスワードが長すぎます";
  return null;
}

export type RegisterResult = { ok: true; staff: Staff } | { ok: false; error: string };

/**
 * 招待リンクからのスタッフ登録。店主が承認するまではログインできない。
 * 店主が先に同じ名前で登録していたスタッフ（ログインなし）は、そのスタッフにパスワードを付ける。
 */
export async function registerStaff(
  repo: Repository,
  input: { code: string; name: string; password: string },
): Promise<RegisterResult> {
  if (!(await isValidInviteCode(repo, input.code))) {
    return { ok: false, error: "このリンクは使えません。店主に新しいリンクをもらってください" };
  }
  const name = input.name.trim();
  if (!name || name.length > 30) return { ok: false, error: "お名前を30文字以内で入力してください" };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };

  const staff = await repo.listStaff();
  if (staff.filter((s) => s.pending).length >= MAX_PENDING) {
    return { ok: false, error: "承認待ちの申請が多いため受け付けられません。店主に連絡してください" };
  }
  const key = normalizeStaffName(name);
  const existing = staff.find((s) => normalizeStaffName(s.name) === key);
  if (existing && (existing.passwordHash || existing.pending)) {
    return { ok: false, error: "この名前はすでに登録されています。別の名前にするか、店主に連絡してください" };
  }
  const passwordHash = hashPassword(input.password);
  const created = existing
    ? await repo.updateStaff(existing.id, { passwordHash, pending: true })
    : await repo.createStaff({
        name,
        backRates: { rate: 0, perVisit: 0 },
        active: true,
        passwordHash,
        pending: true,
      });
  return { ok: true, staff: created };
}

/** スタッフ本人のパスワードでのログイン。承認済み・在籍中・パスワードありのスタッフだけ */
export async function authenticateStaff(repo: Repository, name: string, password: string): Promise<Staff | null> {
  const key = normalizeStaffName(name);
  if (!key) return null;
  // LINEだけで登録した同じ名前のスタッフがいても、パスワードのある人で確かめる
  const candidates = (await repo.listStaff()).filter((x) => normalizeStaffName(x.name) === key && canLogin(x) && x.passwordHash);
  return candidates.find((s) => verifyPassword(password, s.passwordHash)) ?? null;
}

/** ログインできる状態か（パスワードかLINEのどちらかで） */
export const canLogin = (s: Staff) => s.active && !s.pending && !!(s.passwordHash || s.lineUserId);

/**
 * 招待リンクからLINEで登録する。名前はLINEの表示名（店主があとで変えられる）。
 * 店主が先に同じ名前で登録していたスタッフ（ログインなし）には、そのままLINEを付ける。
 */
export async function registerStaffWithLine(
  repo: Repository,
  input: { code: string; lineUserId: string; name: string; ownerLineUserIds: string[] },
): Promise<RegisterResult> {
  if (!(await isValidInviteCode(repo, input.code))) {
    return { ok: false, error: "このリンクは使えません。店主に新しいリンクをもらってください" };
  }
  if (input.ownerLineUserIds.includes(input.lineUserId)) return { ok: false, error: "このLINEは店主として登録されています" };
  const staff = await repo.listStaff();
  const mine = staff.find((s) => s.lineUserId === input.lineUserId);
  if (mine) {
    return { ok: false, error: mine.pending ? "登録の申請は受け付け済みです。店主の承認をお待ちください" : "このLINEはすでに登録されています。ログイン画面からLINEでログインしてください" };
  }
  if (staff.filter((s) => s.pending).length >= MAX_PENDING) {
    return { ok: false, error: "承認待ちの申請が多いため受け付けられません。店主に連絡してください" };
  }
  const name = input.name.trim().slice(0, 30) || "スタッフ";
  const key = normalizeStaffName(name);
  const existing = staff.find((s) => normalizeStaffName(s.name) === key && !s.passwordHash && !s.lineUserId && !s.pending);
  const created = existing
    ? await repo.updateStaff(existing.id, { lineUserId: input.lineUserId, pending: true })
    : await repo.createStaff({ name, backRates: { rate: 0, perVisit: 0 }, active: true, lineUserId: input.lineUserId, pending: true });
  return { ok: true, staff: created };
}

/** ログイン中のスタッフが、自分のアカウントにLINEを連携する */
export async function linkStaffLine(
  repo: Repository,
  staffId: string,
  lineUserId: string,
  ownerLineUserIds: string[],
): Promise<string | null> {
  if (ownerLineUserIds.includes(lineUserId)) return "このLINEは店主として登録されています";
  const other = (await repo.listStaff()).find((s) => s.lineUserId === lineUserId && s.id !== staffId);
  if (other) return "このLINEはほかのスタッフに連携されています";
  await repo.updateStaff(staffId, { lineUserId });
  return null;
}
