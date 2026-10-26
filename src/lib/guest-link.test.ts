import { describe, expect, it } from "vitest";
import { guestReservationToken, readGuestReservationToken } from "./guest-link";

describe("guest reservation link", () => {
  it("reads back its own token and rejects tampering", () => {
    const token = guestReservationToken("shop-1", "res-1");
    expect(readGuestReservationToken(token)).toEqual({ shopId: "shop-1", reservationId: "res-1" });
    expect(readGuestReservationToken(token.replace("res-1", "res-2"))).toBeNull();
    expect(readGuestReservationToken("shop-1~res-1.bad")).toBeNull();
    expect(token).toMatch(/^[A-Za-z0-9~._-]+$/);
  });
});
