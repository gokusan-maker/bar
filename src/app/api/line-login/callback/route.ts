import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentSession, loginWithLine, ownerLineUserIds } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { lineLoginConfig, notifier, repository } from "@/lib/container";
import { lineLoginExchange } from "@/lib/integrations/line-login";
import { decodeLineLoginState, LINE_STATE_COOKIE } from "@/lib/line-login-state";
import { linkStaffLine, registerStaffWithLine } from "@/lib/staff-accounts";

/** LINEログインから戻ってきたところ。目的ごとにログイン・連携・登録をする */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, url));
    res.cookies.delete({ name: LINE_STATE_COOKIE, path: "/api/line-login" });
    return res;
  };
  const config = lineLoginConfig();
  const secret = process.env.SESSION_SECRET;
  const saved = decodeLineLoginState((await cookies()).get(LINE_STATE_COOKIE)?.value, url.searchParams.get("state"), secret ?? "");
  if (!config || !secret || !saved) return go("/login?error=line_state");
  const loginPage = saved.purpose === "owner" || saved.purpose === "link-owner" ? "/owner/login" : "/login";
  // ユーザーがLINEの画面でキャンセルした
  const code = url.searchParams.get("code");
  if (!code) return go(saved.purpose === "join" ? `/join?code=${encodeURIComponent(saved.code ?? "")}` : loginPage);

  let line: { userId: string; name: string };
  try {
    line = await lineLoginExchange(config, code, saved.nonce);
  } catch (error) {
    console.error("LINE login failed", error);
    return go(`${loginPage}?error=line_failed`);
  }

  const repo = repository();
  switch (saved.purpose) {
    case "owner":
    case "staff": {
      const result = await loginWithLine(line.userId, saved.purpose);
      if (result === "ok") return go("/admin");
      return go(`${loginPage}?error=${result === "pending" ? "pending" : "line_unlinked"}`);
    }
    case "link-owner": {
      const session = await currentSession();
      if (session?.role !== "owner") return go("/owner/login");
      if ((await repo.listStaff()).some((s) => s.lineUserId === line.userId)) return go("/admin/settings?line=staff_conflict");
      const settings = await repo.getSettings();
      if (!settings.ownerLineUserIds.includes(line.userId)) {
        await repo.saveSettings({ ...settings, ownerLineUserIds: [...settings.ownerLineUserIds, line.userId] });
        await recordAudit({ actor: "owner", action: "店主のLINEログインを連携", targetType: "settings", targetId: null, detail: line.name });
      }
      return go("/admin/settings?line=linked");
    }
    case "link-staff": {
      const session = await currentSession();
      if (session?.role !== "staff" || !session.staffId) return go("/login");
      const error = await linkStaffLine(repo, session.staffId, line.userId, await ownerLineUserIds());
      if (error) return go(`/admin/account?error=${encodeURIComponent(error)}`);
      await recordAudit({ actor: "staff", action: "LINEログインを連携", targetType: "staff", targetId: session.staffId, detail: session.staffName });
      // 連携するとログインの目印が変わるので、LINEでログインし直す
      await loginWithLine(line.userId, "staff");
      return go("/admin/account?linked=1");
    }
    case "join": {
      const inviteCode = saved.code ?? "";
      const result = await registerStaffWithLine(repo, {
        code: inviteCode,
        lineUserId: line.userId,
        name: line.name,
        ownerLineUserIds: await ownerLineUserIds(),
      });
      if (!result.ok) return go(`/join?code=${encodeURIComponent(inviteCode)}&error=${encodeURIComponent(result.error)}`);
      await recordAudit({ actor: "staff", action: "スタッフ登録を申請（LINE）", targetType: "staff", targetId: result.staff.id, detail: result.staff.name });
      await notifier().notify(`スタッフ登録の申請がありました（LINE）: ${result.staff.name}\n管理画面の「スタッフ」で承認してください`);
      return go(`/join?code=${encodeURIComponent(inviteCode)}&done=1`);
    }
  }
}
