import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, sign, verifySigned } from "../crypto";
import { fromJst } from "../domain/time";
import { DEFAULT_SETTINGS, type Reservation } from "../domain/types";
import { eventBody, eventsToBlocks } from "./google-calendar";
import { parseInstagramEvents, verifyMetaSignature } from "./instagram";
import { lineMessages, parseLineEvents, verifyLineSignature } from "./line";

describe("LINE", () => {
  const body = JSON.stringify({ events: [] });
  const sig = createHmac("sha256", "secret").update(body).digest("base64");

  it("verifies signatures", () => {
    expect(verifyLineSignature(body, sig, "secret")).toBe(true);
    expect(verifyLineSignature(body, sig, "other")).toBe(false);
    expect(verifyLineSignature(body + " ", sig, "secret")).toBe(false);
    expect(verifyLineSignature(body, null, "secret")).toBe(false);
  });

  it("attaches quick replies to the last message", () => {
    const msgs = lineMessages(["a", "b"], [{ label: "とても長いラベルとても長いラベルとても長い", text: "x" }]);
    expect(msgs[0]).toEqual({ type: "text", text: "a" });
    expect(msgs[1].quickReply).toEqual({
      items: [{ type: "action", action: { type: "message", label: "とても長いラベルとても長いラベルとても長", text: "x" } }],
    });
    expect(lineMessages(["a"])[0]).not.toHaveProperty("quickReply");
  });

  it("keeps only 1:1 text messages", () => {
    const events = parseLineEvents({
      events: [
        { type: "message", replyToken: "r1", source: { type: "user", userId: "U1" }, message: { type: "text", text: "hi" } },
        { type: "message", replyToken: "r2", source: { type: "group", userId: "U2" }, message: { type: "text", text: "x" } },
        { type: "message", replyToken: "r3", source: { type: "user", userId: "U3" }, message: { type: "sticker" } },
        { type: "follow", replyToken: "r4", source: { type: "user", userId: "U4" } },
      ],
    });
    expect(events).toEqual([{ replyToken: "r1", userId: "U1", text: "hi" }]);
  });
});

describe("Instagram", () => {
  it("verifies X-Hub-Signature-256", () => {
    const body = '{"object":"instagram"}';
    const hex = createHmac("sha256", "app").update(body).digest("hex");
    expect(verifyMetaSignature(body, `sha256=${hex}`, "app")).toBe(true);
    expect(verifyMetaSignature(body, `sha256=${hex}`, "nope")).toBe(false);
    expect(verifyMetaSignature(body, hex, "app")).toBe(false);
  });

  it("ignores echoes and non-text messages", () => {
    const events = parseInstagramEvents({
      object: "instagram",
      entry: [
        {
          messaging: [
            { sender: { id: "1" }, message: { text: "予約したい" } },
            { sender: { id: "2" }, message: { text: "自分の返信", is_echo: true } },
            { sender: { id: "3" }, message: {} },
          ],
        },
      ],
    });
    expect(events).toEqual([{ senderId: "1", text: "予約したい" }]);
  });
});

describe("Google Calendar", () => {
  it("turns non-reservation events into blocks", () => {
    const blocks = eventsToBlocks([
      { id: "a", start: { dateTime: "2026-10-25T13:00:00Z" }, end: { dateTime: "2026-10-25T15:00:00Z" } },
      { id: "b", start: { date: "2026-10-31" }, end: { date: "2026-11-01" } },
      { id: "c", start: { dateTime: "2026-10-25T12:00:00Z" }, end: { dateTime: "2026-10-25T14:00:00Z" }, extendedProperties: { private: { reservationId: "r" } } },
      { id: "d", transparency: "transparent", start: { dateTime: "2026-10-25T12:00:00Z" }, end: { dateTime: "2026-10-25T14:00:00Z" } },
      { id: "e", status: "cancelled", start: { dateTime: "2026-10-25T12:00:00Z" }, end: { dateTime: "2026-10-25T14:00:00Z" } },
    ]);
    expect(blocks).toEqual([
      { start: new Date("2026-10-25T13:00:00Z"), end: new Date("2026-10-25T15:00:00Z") },
      // 終日予定はその夜の営業（深夜帯含む）を塞ぐ
      { start: fromJst("2026-10-31", "06:00"), end: fromJst("2026-11-01", "06:00") },
    ]);
  });

  it("builds event bodies with status labels and the reservation id", () => {
    const r: Reservation = {
      id: "r1",
      customerId: "c1",
      startAt: "2026-10-25T12:00:00.000Z",
      endAt: "2026-10-25T14:00:00.000Z",
      partySize: 2,
      name: "山田",
      notes: "カウンター希望",
      status: "pending",
      channel: "line",
      googleEventId: null,
      reminderSentAt: null,
      createdAt: "",
      updatedAt: "",
    };
    const body = eventBody(r, DEFAULT_SETTINGS, "https://bar.example");
    expect(body.summary).toBe("【仮予約】山田様 2名");
    expect(body.description).toContain("要望: カウンター希望");
    expect(body.description).toContain("https://bar.example/admin/reservations/r1");
    expect(body.extendedProperties.private.reservationId).toBe("r1");
    expect(eventBody({ ...r, status: "confirmed" }, DEFAULT_SETTINGS, null).summary).toBe("【予約】山田様 2名");
  });
});

describe("crypto", () => {
  it("round-trips encrypted values and detects tampering", () => {
    const token = encrypt("refresh-token", "key");
    expect(token).not.toContain("refresh-token");
    expect(decrypt(token, "key")).toBe("refresh-token");
    expect(() => decrypt(token, "other")).toThrow();
  });

  it("signs and verifies values", () => {
    const v = sign("admin:123", "s");
    expect(verifySigned(v, "s")).toBe("admin:123");
    expect(verifySigned(v, "x")).toBeNull();
    expect(verifySigned("admin:999." + v.split(".")[1], "s")).toBeNull();
    expect(verifySigned(undefined, "s")).toBeNull();
  });
});
