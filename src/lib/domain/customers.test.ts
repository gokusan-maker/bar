import { describe, expect, it } from "vitest";
import { summarizeCustomers } from "./customers";
import type { Customer, Reservation, Sale } from "./types";

const customer = (id: string): Customer => ({
  id, channel: "line", externalId: id, displayName: id, name: null, note: null, staffId: null, phone: null, birthday: null, tags: [], birthdayGreetedYear: null, createdAt: "",
});
const res = (customerId: string, status: Reservation["status"], startAt: string): Reservation => ({
  id: `${customerId}-${startAt}`, customerId, startAt, endAt: startAt, partySize: 2, name: "x", notes: null,
  status, channel: "line", googleEventId: null, reminderSentAt: null, createdAt: "", updatedAt: "",
});
const sale = (customerId: string, businessDate: string, reservationId: string | null): Sale => ({
  id: Math.random().toString(), businessDate, reservationId, customerId, staffId: null, channel: "line",
  customerName: null, partySize: 2, drinkAmount: 4000, chargeAmount: 2000, serviceAmount: 600, note: null,
  createdAt: "", updatedAt: "",
});

describe("summarizeCustomers", () => {
  it("counts visits without double counting reservation-linked sales", () => {
    const visited = res("a", "visited", "2026-10-03T12:00:00.000Z");
    const [a] = summarizeCustomers(
      [customer("a")],
      [visited, res("a", "no_show", "2026-10-10T12:00:00.000Z"), res("a", "confirmed", "2026-11-01T12:00:00.000Z")],
      [sale("a", "2026-10-03", visited.id), sale("a", "2026-10-15", null)],
      (r) => r.startAt.slice(0, 10),
      new Date("2026-10-20T00:00:00Z"),
    );
    expect(a).toMatchObject({ visits: 2, noShows: 1, upcoming: 1, lastVisit: "2026-10-15", totalSpend: 13200 });
  });

  it("returns empty stats for new customers", () => {
    const [b] = summarizeCustomers([customer("b")], [], [], () => "", new Date());
    expect(b).toMatchObject({ visits: 0, lastVisit: null, totalSpend: 0 });
  });
});

describe("customer profile helpers", () => {
  it("parses tags, birthdays and phone numbers", async () => {
    const { parseTags, parseBirthday, parsePhone, phoneLabel } = await import("./customers");
    expect(parseTags("常連, VIP、ワイン好き 常連 #ＶＩＰ")).toEqual(["常連", "VIP", "ワイン好き"]);
    expect(parseBirthday("5/3")).toBe("05-03");
    expect(parseBirthday("1990/12/31")).toBe("12-31");
    expect(parseBirthday("2月29日")).toBe("02-29");
    expect(parseBirthday("2/30")).toBeNull();
    expect(parseBirthday("")).toBeNull();
    expect(parsePhone("090-1234-5678")).toBe("09012345678");
    expect(parsePhone("０３（１２３４）５６７８")).toBe("0312345678");
    expect(parsePhone("1234")).toBeNull();
    expect(phoneLabel("09012345678")).toBe("090-1234-5678");
    expect(phoneLabel("0312345678")).toBe("03-1234-5678");
  });
});
