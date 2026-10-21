import { describe, expect, it } from "vitest";
import { explainError } from "./diagnostics";

describe("explainError", () => {
  it("explains auth and network failures in plain words", () => {
    expect(explainError(new Error("LINE API /info failed: 401 {}"))).toContain("認証に失敗");
    expect(explainError(Object.assign(new Error("x"), { status: 403 }))).toContain("認証に失敗");
    expect(explainError(new Error("Google token request failed: 400 invalid_grant"))).toContain("認証に失敗");
    expect(explainError(new TypeError("fetch failed"))).toContain("接続できません");
    expect(explainError(new Error("something else"))).toBe("something else");
  });
});
