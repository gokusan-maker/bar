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

/** ログインIDは大文字・小文字を区別しない（全角も半角にそろえる） */
export const normalizeLoginId = (id: string) => id.normalize("NFKC").trim().toLowerCase();

/** ログインIDとして使えるか。使えなければ理由 */
export function loginIdProblem(id: string): string | null {
  if (!/^[a-z0-9][a-z0-9_.-]{2,29}$/.test(id)) return "ログインIDは3〜30文字の半角英数字（- _ . も可）にしてください";
  return null;
}

/** ほかのスタッフ・オーナーが使っていないか */
export async function loginIdTaken(repo: Repository, id: string, exceptStaffId?: string): Promise<boolean> {
  if (normalizeLoginId((await repo.getSettings()).ownerLoginId) === id) return true;
  return (await repo.listStaff()).some((s) => s.loginId === id && s.id !== exceptStaffId);
}

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
  input: { code: string; name: string; password: string; loginId: string },
): Promise<RegisterResult> {
  if (!(await isValidInviteCode(repo, input.code))) {
    return { ok: false, error: "このリンクは使えません。店主に新しいリンクをもらってください" };
  }
  const name = input.name.trim();
  if (!name || name.length > 30) return { ok: false, error: "お名前を30文字以内で入力してください" };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };
  const loginId = normalizeLoginId(input.loginId);
  const idProblem = loginIdProblem(loginId);
  if (idProblem) return { ok: false, error: idProblem };
  if (await loginIdTaken(repo, loginId)) return { ok: false, error: "このログインIDはすでに使われています。別のIDにしてください" };

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
    ? await repo.updateStaff(existing.id, { passwordHash, loginId, pending: true })
    : await repo.createStaff({
        name,
        backRates: { rate: 0, perVisit: 0 },
        active: true,
        passwordHash,
        loginId,
        pending: true,
      });
  return { ok: true, staff: created };
}

/**
 * スタッフ本人のIDとパスワードでのログイン。承認済み・在籍中・パスワードありのスタッフだけ。
 * ログインIDで探し、見つからなければ名前で探す（ID導入前に名前で登録した人のため）。
 */
export async function authenticateStaff(repo: Repository, idOrName: string, password: string): Promise<Staff | null> {
  const all = (await repo.listStaff()).filter((x) => canLogin(x) && x.passwordHash);
  const byId = all.find((x) => x.loginId === normalizeLoginId(idOrName));
  if (byId) return verifyPassword(password, byId.passwordHash) ? byId : null;
  const key = normalizeStaffName(idOrName);
  if (!key) return null;
  // LINEだけで登録した同じ名前のスタッフがいても、パスワードのある人で確かめる
  const candidates = all.filter((x) => normalizeStaffName(x.name) === key);
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
