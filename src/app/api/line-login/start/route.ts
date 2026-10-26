import { NextResponse } from "next/server";
import { lineLoginConfig } from "@/lib/container";
import { lineLoginAuthorizeUrl } from "@/lib/integrations/line-login";
import { encodeLineLoginState, LINE_LOGIN_PURPOSES, LINE_STATE_COOKIE, newLineLoginState, type LineLoginPurpose } from "@/lib/line-login-state";

/** 「LINEでログイン」ボタンの行き先。目的を署名付きCookieに覚えてLINEへ送る */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const purpose = url.searchParams.get("purpose") as LineLoginPurpose;
  const config = lineLoginConfig();
  const secret = process.env.SESSION_SECRET;
  if (!config || !secret || !LINE_LOGIN_PURPOSES.includes(purpose)) {
    return NextResponse.redirect(new URL(purpose === "owner" ? "/owner/login?error=line_off" : "/login?error=line_off", url));
  }
  const state = newLineLoginState(purpose, url.searchParams.get("code") ?? undefined);
  const res = NextResponse.redirect(lineLoginAuthorizeUrl(config, state.state, state.nonce));
  res.cookies.set(LINE_STATE_COOKIE, encodeLineLoginState(state, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/line-login",
    maxAge: 600,
  });
  return res;
}
