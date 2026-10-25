import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { MemoryDirectory } from "./directory";
import { MemoryRepository } from "./repo/memory";
import { authenticateStaff, canLogin, linkStaffLine, MAX_PENDING, newInviteCode, registerStaff, registerStaffWithLine } from "./staff-accounts";

describe("password", () => {
  it("verifies only the original password", () => {
    const hash = hashPassword("correct horse");
    expect(verifyPassword("correct horse", hash)).toBe(true);
    expect(verifyPassword("correct hors", hash)).toBe(false);
    expect(verifyPassword("anything", null)).toBe(false);
    expect(verifyPassword("anything", "garbage")).toBe(false);
  });
});

describe("staff self-registration", () => {
  let repo: MemoryRepository;
  let code: string;

  beforeEach(async () => {
    repo = new MemoryRepository();
    code = newInviteCode();
    await repo.saveSettings({ ...(await repo.getSettings()), staffInviteCode: code });
  });

  let n = 0;
  const register = (name: string, password = "password1", c = code, loginId = `staff${++n}`) =>
    registerStaff(repo, new MemoryDirectory(repo), { code: c, name, password, loginId });

  it("rejects a wrong or disabled invite code", async () => {
    expect((await register("ゆか", "password1", "wrong")).ok).toBe(false);
    await repo.saveSettings({ ...(await repo.getSettings()), staffInviteCode: "" });
    expect((await register("ゆか", "password1", "")).ok).toBe(false);
  });

  it("cannot log in until the owner approves", async () => {
    const r = await register("ゆか");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.staff.pending).toBe(true);
    expect(await authenticateStaff(repo, "ゆか", "password1")).toBeNull();

    await repo.updateStaff(r.staff.id, { pending: false });
    expect((await authenticateStaff(repo, " ゆか ", "password1"))?.id).toBe(r.staff.id);
    expect(await authenticateStaff(repo, "ゆか", "wrongpass")).toBeNull();

    await repo.updateStaff(r.staff.id, { active: false });
    expect(await authenticateStaff(repo, "ゆか", "password1")).toBeNull();
  });

  it("attaches the login to a staff the owner already added, keeping back rates", async () => {
    const existing = await repo.createStaff({ name: "ＹＵＫＩ", active: true, backRates: { rate: 10, perVisit: 0 } });
    const r = await register("yuki");
    expect(r.ok && r.staff.id).toBe(existing.id);
    expect((await repo.getStaff(existing.id))?.backRates.rate).toBe(10);
    expect(await repo.listStaff()).toHaveLength(1);
  });

  it("refuses a name someone already logs in with, short passwords and too many pending", async () => {
    expect((await register("ゆか")).ok).toBe(true);
    expect(await register("ゆか", "otherpass")).toMatchObject({ ok: false });
    expect(await register("みき", "short")).toMatchObject({ ok: false });
    for (let i = 1; i < MAX_PENDING; i++) expect((await register(`staff${i}`)).ok).toBe(true);
    expect(await register("もう一人")).toMatchObject({ ok: false });
  });
});

describe("staff LINE login", () => {
  let repo: MemoryRepository;
  let code: string;

  beforeEach(async () => {
    repo = new MemoryRepository();
    code = newInviteCode();
    await repo.saveSettings({ ...(await repo.getSettings()), staffInviteCode: code });
  });

  it("registers with LINE as pending, and cannot register the same LINE twice", async () => {
    const r = await registerStaffWithLine(repo, new MemoryDirectory(repo), { code, lineUserId: "U1", name: "ゆか", ownerLineUserIds: [] });
    expect(r).toMatchObject({ ok: true, staff: { name: "ゆか", lineUserId: "U1", pending: true } });
    if (r.ok) expect(canLogin(r.staff)).toBe(false);
    expect(await registerStaffWithLine(repo, new MemoryDirectory(repo), { code, lineUserId: "U1", name: "ゆか", ownerLineUserIds: [] })).toMatchObject({ ok: false });
    expect(await registerStaffWithLine(repo, new MemoryDirectory(repo), { code: "bad", lineUserId: "U2", name: "x", ownerLineUserIds: [] })).toMatchObject({ ok: false });
    expect(await registerStaffWithLine(repo, new MemoryDirectory(repo), { code, lineUserId: "OWNER", name: "x", ownerLineUserIds: ["OWNER"] })).toMatchObject({ ok: false });
  });

  it("attaches LINE to a staff the owner already added, and approved LINE staff can log in", async () => {
    const existing = await repo.createStaff({ name: "みき", active: true, backRates: { rate: 20, perVisit: 0 } });
    const r = await registerStaffWithLine(repo, new MemoryDirectory(repo), { code, lineUserId: "U3", name: "みき", ownerLineUserIds: [] });
    expect(r.ok && r.staff.id).toBe(existing.id);
    await repo.updateStaff(existing.id, { pending: false });
    const s = await repo.getStaff(existing.id);
    expect(s && canLogin(s)).toBe(true);
    expect(s?.backRates.rate).toBe(20);
  });

  it("links LINE to a logged-in staff unless another account uses it", async () => {
    const a = await repo.createStaff({ name: "a", active: true, backRates: { rate: 0, perVisit: 0 } });
    const b = await repo.createStaff({ name: "b", active: true, backRates: { rate: 0, perVisit: 0 } });
    expect(await linkStaffLine(repo, new MemoryDirectory(repo), a.id, "U9", [])).toBeNull();
    expect(await linkStaffLine(repo, new MemoryDirectory(repo), b.id, "U9", [])).toContain("ほかのアカウント");
    expect(await linkStaffLine(repo, new MemoryDirectory(repo), b.id, "OWN", ["OWN"])).toContain("店主");
  });

  it("checks passwords against the right person when a LINE-only staff has the same name", async () => {
    await repo.createStaff({ name: "ゆか", active: true, backRates: { rate: 0, perVisit: 0 }, lineUserId: "U5" });
    const withPassword = await repo.createStaff({ name: "ゆか", active: true, backRates: { rate: 0, perVisit: 0 }, passwordHash: hashPassword("password1") });
    expect((await authenticateStaff(repo, "ゆか", "password1"))?.id).toBe(withPassword.id);
  });
});

describe("login IDs", () => {
  it("logs in by login ID (case-insensitive) and still by name, and keeps IDs unique", async () => {
    const repo = new MemoryRepository();
    const code = newInviteCode();
    await repo.saveSettings({ ...(await repo.getSettings()), staffInviteCode: code });
    const r = await registerStaff(repo, new MemoryDirectory(repo), { code, name: "ゆか", password: "password1", loginId: "Yuka_01" });
    expect(r).toMatchObject({ ok: true, staff: { loginId: "yuka_01" } });
    if (!r.ok) return;
    await repo.updateStaff(r.staff.id, { pending: false });
    expect((await authenticateStaff(repo, "YUKA_01", "password1"))?.id).toBe(r.staff.id);
    expect((await authenticateStaff(repo, "ゆか", "password1"))?.id).toBe(r.staff.id);
    expect(await authenticateStaff(repo, "yuka_01", "wrong-pass")).toBeNull();
    // 同じID・オーナーのID・使えない文字は登録できない
    expect(await registerStaff(repo, new MemoryDirectory(repo), { code, name: "みき", password: "password1", loginId: "yuka_01" })).toMatchObject({ ok: false });
    expect(await registerStaff(repo, new MemoryDirectory(repo), { code, name: "みき", password: "password1", loginId: "admin" }, ["admin"])).toMatchObject({ ok: false });
    expect(await registerStaff(repo, new MemoryDirectory(repo), { code, name: "みき", password: "password1", loginId: "み" })).toMatchObject({ ok: false });
  });
});
