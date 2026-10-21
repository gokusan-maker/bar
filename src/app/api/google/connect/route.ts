import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { googleOAuthConfig } from "@/lib/container";
import { buildAuthUrl } from "@/lib/integrations/google-calendar";

export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.redirect(new URL("/login", req.url));
  const config = googleOAuthConfig();
  if (!config) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / APP_BASE_URL を設定してください" },
      { status: 503 },
    );
  }
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return NextResponse.redirect(buildAuthUrl(config, state));
}
