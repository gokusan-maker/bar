import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { MemoryRepository } from "./repo/memory";
import { authenticateStaff, MAX_PENDING, newInviteCode, registerStaff } from "./staff-accounts";

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

  const register = (name: string, password = "password1", c = code) => registerStaff(repo, { code: c, name, password });

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
