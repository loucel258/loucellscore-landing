import { describe, it, expect } from "vitest";
import {
  buildThreads,
  cleanName,
  conversationHref,
  filterThreads,
  formatPhone,
  inboxHref,
  parseInboxParams,
  threadDisplayName,
  threadHref,
  type SmsMessageRow,
  type WebMessageRow,
} from "@/lib/portal/threads";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";

function web(id: string, session: string, role: WebMessageRow["role"], at: string): WebMessageRow {
  return { id, session_id: session, role, inserted_at: at, tool_summary: null, cipher_b64: "x" };
}
function sms(id: string, contact: string | null, direction: SmsMessageRow["direction"], at: string): SmsMessageRow {
  return { id, contact_id: contact, workspace_id: "ws_a", direction, body: "hi", status: null, created_at: at };
}

describe("buildThreads", () => {
  it("groups web messages by session and SMS by contact into one list, newest first", () => {
    const threads = buildThreads({
      webMessages: [
        web("w1", "s_one", "user", "2026-09-30T10:00:00Z"),
        web("w2", "s_one", "assistant", "2026-09-30T10:00:05Z"),
        web("w3", "s_two", "user", "2026-09-29T08:00:00Z"),
      ],
      smsMessages: [
        sms("m1", C1, "inbound", "2026-09-30T12:00:00Z"),
        sms("m2", C1, "outbound", "2026-09-30T12:00:10Z"),
        sms("m3", null, "inbound", "2026-09-30T13:00:00Z"),
      ],
    });
    expect(threads.map((t) => t.key)).toEqual([`sms:${C1}`, "web:s_one", "web:s_two"]);
    const s1 = threads.find((t) => t.key === "web:s_one")!;
    expect(s1.messageCount).toBe(2);
    expect(s1.firstAt).toBe("2026-09-30T10:00:00Z");
    expect(s1.lastAt).toBe("2026-09-30T10:00:05Z");
    expect(s1.lastFromCustomer).toBe(false);
    const sm = threads.find((t) => t.channel === "sms")!;
    expect(sm.messageCount).toBe(2);
    expect(sm.lastFromCustomer).toBe(false);
  });

  it("names web threads from leads (real names beat placeholders) and SMS from contacts", () => {
    const threads = buildThreads({
      webMessages: [web("w1", "s_one", "user", "2026-09-30T10:00:00Z")],
      smsMessages: [sms("m1", C1, "inbound", "2026-09-30T12:00:00Z")],
      leads: [
        { session_id: "s_one", name: "Ana Pérez", email: "ana@x.com", booking_status: "offered", created_at: "2026-09-30T10:01:00Z" },
        { session_id: "s_one", name: "[escalation]", email: "", booking_status: "offered", created_at: "2026-09-30T10:05:00Z" },
      ],
      contacts: [{ id: C1, name: null, phone: "+13055551234" }],
    });
    const w = threads.find((t) => t.channel === "web")!;
    expect(w.name).toBe("Ana Pérez");
    expect(w.email).toBe("ana@x.com");
    const s = threads.find((t) => t.channel === "sms")!;
    expect(s.name).toBeNull();
    expect(threadDisplayName(s, "Website visitor")).toBe("(305) 555-1234");
    expect(threadDisplayName({ name: null, phone: null, channel: "web" }, "Website visitor")).toBe("Website visitor");
  });

  it("sets taken over, urgent and booked flags per channel", () => {
    const threads = buildThreads({
      webMessages: [
        web("w1", "s_paused", "user", "2026-09-30T10:00:00Z"),
        web("w2", "s_tagged", "user", "2026-09-30T10:00:00Z"),
        web("w3", "s_booked", "user", "2026-09-30T10:00:00Z"),
        web("w4", "s_escalated", "user", "2026-09-30T10:00:00Z"),
      ],
      smsMessages: [sms("m1", C1, "inbound", "2026-09-30T12:00:00Z"), sms("m2", C2, "inbound", "2026-09-30T12:00:00Z")],
      leads: [{ session_id: "s_booked", name: "B", email: "b@x.com", booking_status: "confirmed", created_at: "2026-09-30T10:00:00Z" }],
      flags: {
        pausedSessionIds: ["s_paused"],
        tags: [{ session_id: "s_tagged", tag: "urgent" }],
        escalations: [
          { session_id: "s_escalated", contact_id: null },
          { session_id: null, contact_id: C2 },
        ],
        bookedContactIds: [C1],
      },
    });
    const by = (k: string) => threads.find((t) => t.key === k)!;
    expect(by("web:s_paused").takenOver).toBe(true);
    expect(by("web:s_tagged").urgent).toBe(true);
    expect(by("web:s_tagged").tags).toEqual(["urgent"]);
    expect(by("web:s_escalated").urgent).toBe(true);
    expect(by("web:s_booked").booked).toBe(true);
    expect(by(`sms:${C1}`).booked).toBe(true);
    expect(by(`sms:${C2}`).urgent).toBe(true);
    expect(by(`sms:${C2}`).takenOver).toBe(false);

    expect(filterThreads(threads, "taken").map((t) => t.key)).toEqual(["web:s_paused"]);
    expect(filterThreads(threads, "urgent").map((t) => t.key).sort()).toEqual(
      ["web:s_escalated", "web:s_tagged", `sms:${C2}`].sort(),
    );
    expect(filterThreads(threads, "booked").map((t) => t.key).sort()).toEqual(["web:s_booked", `sms:${C1}`].sort());
    expect(filterThreads(threads, "all", "urgent").map((t) => t.key)).toEqual(["web:s_tagged"]);
    expect(filterThreads(threads, "all", "not_a_tag")).toHaveLength(threads.length);
  });
});

describe("inbox URLs", () => {
  it("parses and validates the query", () => {
    expect(parseInboxParams({ sms: C1, f: "urgent", tag: "vip" })).toEqual({
      selected: { channel: "sms", id: C1 },
      filter: "urgent",
      tag: "vip",
    });
    expect(parseInboxParams({ session: "s_abc123", f: "nope", tag: "x" })).toEqual({
      selected: { channel: "web", id: "s_abc123" },
      filter: "all",
      tag: null,
    });
    // A non-uuid contact id is ignored rather than queried.
    expect(parseInboxParams({ sms: "1; drop" }).selected).toBeNull();
    expect(parseInboxParams({ session: "a\u0000b" }).selected).toBeNull();
    expect(parseInboxParams({}).selected).toBeNull();
  });

  it("builds thread and list links that keep the filter", () => {
    expect(threadHref("acme", { channel: "web", id: "s 1" })).toBe("/portal/acme/bandeja?session=s+1");
    expect(threadHref("acme", { channel: "sms", id: C1 }, { filter: "booked", tag: "vip" })).toBe(
      `/portal/acme/bandeja?sms=${C1}&f=booked&tag=vip`,
    );
    expect(inboxHref("acme")).toBe("/portal/acme/bandeja");
    expect(inboxHref("acme", { filter: "all", tag: null })).toBe("/portal/acme/bandeja");
    expect(inboxHref("acme", { filter: "taken" })).toBe("/portal/acme/bandeja?f=taken");
  });

  it("links an approval or escalation to its conversation when known", () => {
    expect(conversationHref("acme", { session_id: "s_abc", contact_id: null })).toBe("/portal/acme/bandeja?session=s_abc");
    expect(conversationHref("acme", { session_id: null, contact_id: C1 })).toBe(`/portal/acme/bandeja?sms=${C1}`);
    expect(conversationHref("acme", { session_id: null, contact_id: null })).toBeNull();
    expect(conversationHref("acme", {})).toBeNull();
  });
});

describe("names and phones", () => {
  it("drops placeholder names", () => {
    expect(cleanName("  Ana ")).toBe("Ana");
    expect(cleanName("[escalation]")).toBeNull();
    expect(cleanName("")).toBeNull();
    expect(cleanName(null)).toBeNull();
  });
  it("formats US numbers and leaves others alone", () => {
    expect(formatPhone("+13055551234")).toBe("(305) 555-1234");
    expect(formatPhone("+525512345678")).toBe("+525512345678");
  });
});
