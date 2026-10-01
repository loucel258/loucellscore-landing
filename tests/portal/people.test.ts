import { describe, it, expect } from "vitest";
import { isPhoneKey, mergePeople, phoneKey } from "@/lib/portal/people";

describe("mergePeople (Customers list)", () => {
  it("merges web leads by email regardless of casing", () => {
    const people = mergePeople(
      [
        { email: "Ana@Mail.com", name: "Ana", session_id: "s1", booking_status: "confirmed", created_at: "2026-09-01T00:00:00Z" },
        { email: "ana@mail.com", name: "Ana P", session_id: "s2", booking_status: "offered", created_at: "2026-09-10T00:00:00Z" },
        { email: "", name: "No email", session_id: "s3", booking_status: "offered", created_at: "2026-09-10T00:00:00Z" },
      ],
      [],
    );
    expect(people).toHaveLength(1);
    const p = people[0]!;
    expect(p.key).toBe("ana@mail.com");
    expect(p.conversations).toBe(2);
    expect(p.bookings).toBe(1);
    expect(p.firstSeen).toBe("2026-09-01T00:00:00Z");
    expect(p.lastSeen).toBe("2026-09-10T00:00:00Z");
    expect(p.name).toBe("Ana P");
    expect(p.channels).toEqual(["web"]);
  });

  it("dedupes SMS contacts by phone across agents and keys them tel:", () => {
    const people = mergePeople(
      [],
      [
        { id: "c1", phone: "+13055551234", name: null, created_at: "2026-09-01T00:00:00Z" },
        { id: "c2", phone: "+13055551234", name: "Luis", created_at: "2026-09-05T00:00:00Z" },
      ],
      new Map([
        ["c1", { firstAt: "2026-09-02T00:00:00Z", lastAt: "2026-09-03T00:00:00Z", bookings: 1 }],
        ["c2", { lastAt: "2026-09-20T00:00:00Z" }],
      ]),
    );
    expect(people).toHaveLength(1);
    const p = people[0]!;
    expect(p.key).toBe("tel:+13055551234");
    expect(isPhoneKey(p.key)).toBe(true);
    expect(p.name).toBe("Luis");
    expect(p.contactIds.sort()).toEqual(["c1", "c2"]);
    expect(p.conversations).toBe(2);
    expect(p.bookings).toBe(1);
    expect(p.lastSeen).toBe("2026-09-20T00:00:00Z");
    expect(p.channels).toEqual(["sms"]);
  });

  it("joins a contact to a web person only when its record carries the same email", () => {
    const people = mergePeople(
      [{ email: "ana@mail.com", name: "Ana", session_id: "s1", booking_status: null, created_at: "2026-09-01T00:00:00Z" }],
      [
        { id: "c1", phone: "+13055550000", name: "Ana", created_at: "2026-09-02T00:00:00Z", metadata: { email: "ANA@mail.com" } },
        { id: "c2", phone: "+13055559999", name: "Ana", created_at: "2026-09-02T00:00:00Z" },
      ],
    );
    expect(people).toHaveLength(2);
    const ana = people.find((p) => p.key === "ana@mail.com")!;
    expect(ana.channels.sort()).toEqual(["sms", "web"]);
    expect(ana.phone).toBe("+13055550000");
    expect(ana.conversations).toBe(2);
    // Same name, no shared email or phone: a different person.
    expect(people.find((p) => p.key === phoneKey("+13055559999"))).toBeTruthy();
  });

  it("only accepts E.164 phone keys", () => {
    expect(isPhoneKey("tel:+13055551234")).toBe(true);
    expect(isPhoneKey("tel:3055551234")).toBe(false);
    expect(isPhoneKey("ana@mail.com")).toBe(false);
  });
});
