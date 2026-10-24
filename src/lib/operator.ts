import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sign, verifySigned } from "./crypto";

/** 運営（このアプリを販売する人）の画面。OPERATOR_PASSWORD を決めたときだけ使える */
const COOKIE = "bar_operator";
const HOURS = 12;

export const operatorEnabled = () => !!(process.env.OPERATOR_PASSWORD && process.env.SESSION_SECRET);

export async function isOperator(): Promise<boolean> {
  if (!operatorEnabled()) return false;
  const payload = verifySigned((await cookies()).get(COOKIE)?.value, process.env.SESSION_SECRET!);
  return !!payload && Number(payload.split(":")[1]) > Date.now();
}

export async function loginOperator(password: string): Promise<boolean> {
  if (!operatorEnabled()) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(process.env.OPERATOR_PASSWORD!);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const expiresAt = Date.now() + HOURS * 3600_000;
  (await cookies()).set(COOKIE, sign(`operator:${expiresAt}`, process.env.SESSION_SECRET!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/operator",
    expires: new Date(expiresAt),
  });
  return true;
}
