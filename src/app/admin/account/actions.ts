"use server";

import { redirect } from "next/navigation";
import { currentSession, reservedLoginIds, startMemberSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { directory, repository } from "@/lib/container";
import { hashPassword, verifyPassword } from "@/lib/password";
import { loginIdProblem, loginIdTaken, normalizeLoginId, passwordProblem } from "@/lib/staff-accounts";

const back = (params: Record<string, string>): never => redirect(`/admin/account?${new URLSearchParams(params)}`);

/** スタッフが自分のログインIDを決める・変える */
export async function changeOwnLoginIdAction(formData: FormData) {
  const session = await currentSession();
  if (!session?.memberId) redirect("/login");
  const repo = repository();
  const id = normalizeLoginId(String(formData.get("loginId") ?? ""));
  const problem = loginIdProblem(id);
  if (problem) back({ error: problem });
  if (await loginIdTaken(directory(), id, session.memberId, await reservedLoginIds())) back({ error: "このログインIDはすでに使われています" });
  await repo.updateStaff(session.memberId, { loginId: id });
  back({ saved: "id" });
}

/** スタッフが自分のパスワードを決める・変える（LINEだけで登録した人は今のパスワードなしで決められる） */
export async function changeOwnPasswordAction(formData: FormData) {
  const session = await currentSession();
  if (!session?.memberId) redirect("/login");
  const repo = repository();
  const me = await repo.getStaff(session.memberId);
  if (!me) redirect("/login");
  const next = String(formData.get("newPassword") ?? "");
  if (me.passwordHash && !verifyPassword(String(formData.get("currentPassword") ?? ""), me.passwordHash)) {
    back({ error: "今のパスワードが違います" });
  }
  const problem = passwordProblem(next);
  if (problem) back({ error: problem });
  if (next !== String(formData.get("newPassword2") ?? "")) back({ error: "確認用のパスワードが一致しません" });
  await repo.updateStaff(me.id, { passwordHash: hashPassword(next) });
  await recordAudit({ actor: session.role, action: "自分のパスワードを変更", targetType: "staff", targetId: me.id, detail: me.name });
  // パスワードを変えるとログインの目印が変わるので、新しい状態でログインし直す
  const updated = await repo.getStaff(me.id);
  if (updated) await startMemberSession(session.shopId, updated);
  back({ saved: "1" });
}
