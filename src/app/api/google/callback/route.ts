import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { googleOAuthConfig, repository } from "@/lib/container";
import { exchangeCode } from "@/lib/integrations/google-calendar";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const settingsUrl = (result: string) => new URL(`/admin/settings?google=${result}`, req.url);
  if (!(await isAdmin())) return NextResponse.redirect(new URL("/login", req.url));

  const jar = await cookies();
  const expectedState = jar.get("google_oauth_state")?.value;
  jar.delete({ name: "google_oauth_state", path: "/api/google" });
  const config = googleOAuthConfig();
  const code = url.searchParams.get("code");
  if (!config || !code || !expectedState || url.searchParams.get("state") !== expectedState) {
    return NextResponse.redirect(settingsUrl("error"));
  }
  try {
    const { refreshToken, email } = await exchangeCode(config, code);
    const repo = repository();
    const current = await repo.getGoogleIntegration();
    await repo.saveGoogleIntegration({
      refreshToken,
      calendarId: current?.calendarId ?? "primary",
      accountEmail: email,
    });
    await recordAudit({ actor: "owner", action: "Googleカレンダーと連携", targetType: "integration", targetId: null, detail: email });
    return NextResponse.redirect(settingsUrl("connected"));
  } catch (error) {
    console.error("Google OAuth failed", error);
    return NextResponse.redirect(settingsUrl("error"));
  }
}
