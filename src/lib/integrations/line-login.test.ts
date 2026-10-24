import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeLineLoginState, encodeLineLoginState, newLineLoginState } from "../line-login-state";
import { lineLoginAuthorizeUrl, lineLoginExchange } from "./line-login";

const config = { channelId: "123", channelSecret: "sec", redirectUri: "https://bar.example/api/line-login/callback" };

describe("LINE login", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds the authorize URL with openid scope, state and nonce", () => {
    const url = new URL(lineLoginAuthorizeUrl(config, "st", "no"));
    expect(url.origin + url.pathname).toBe("https://access.line.me/oauth2/v2.1/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "123", state: "st", nonce: "no", scope: "profile openid", redirect_uri: config.redirectUri });
  });

  it("exchanges the code and verifies the ID token with the nonce", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      if (url.endsWith("/token")) return new Response(JSON.stringify({ id_token: "idt", access_token: "at" }));
      return new Response(JSON.stringify({ sub: "U123", name: "ゆか" }));
    });
    expect(await lineLoginExchange(config, "code1", "nonce1")).toEqual({ userId: "U123", name: "ゆか" });
    expect(new URLSearchParams(calls[0].body).get("code")).toBe("code1");
    expect(Object.fromEntries(new URLSearchParams(calls[1].body))).toEqual({ id_token: "idt", client_id: "123", nonce: "nonce1" });
  });

  it("fails when LINE rejects the token", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("/token") ? new Response(JSON.stringify({ id_token: "idt" })) : new Response("bad nonce", { status: 400 }),
    );
    await expect(lineLoginExchange(config, "c", "n")).rejects.toThrow("verify 400");
  });

  it("accepts the state cookie only with the matching state, signature and time", () => {
    const s = newLineLoginState("join", "invite1");
    const cookie = encodeLineLoginState(s, "secret");
    expect(decodeLineLoginState(cookie, s.state, "secret")).toMatchObject({ purpose: "join", code: "invite1", nonce: s.nonce });
    expect(decodeLineLoginState(cookie, "other", "secret")).toBeNull();
    expect(decodeLineLoginState(cookie, s.state, "wrong-secret")).toBeNull();
    expect(decodeLineLoginState(encodeLineLoginState({ ...s, exp: Date.now() - 1 }, "secret"), s.state, "secret")).toBeNull();
  });
});
