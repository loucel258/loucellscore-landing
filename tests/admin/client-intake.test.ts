import { describe, it, expect } from "vitest";
import {
  NewClientInputSchema,
  buildEngagementRef,
  engagementInitials,
  idempotencyTag,
} from "@/lib/admin/client-intake";
import { isMissingColumnError, isMissingTableError, isUniqueViolation } from "@/lib/admin/db-errors";

const KEY = "3f9a1c2b-5d6e-4f70-8a1b-2c3d4e5f6a7b";

describe("engagement references", () => {
  it("keeps the OGA convention for audits", () => {
    expect(buildEngagementRef("Sunset Roofing LLC", { date: new Date("2026-10-01T15:00:00Z") })).toBe(
      "OGA-20261001-SRL",
    );
  });

  it("tags builds with the idempotency key", () => {
    expect(idempotencyTag(KEY)).toBe("3F9A1C2B");
    expect(
      buildEngagementRef("Peluquería Ñandú", { prefix: "BLD", date: new Date("2026-10-01T15:00:00Z"), tag: idempotencyTag(KEY) }),
    ).toBe("BLD-20261001-P-3F9A1C2B"); // non A-Z initials are dropped
  });

  it("falls back to XXXX without usable initials", () => {
    expect(engagementInitials("!!! ???")).toBe("");
    expect(buildEngagementRef("!!!", { date: new Date("2026-10-01T00:00:00Z") })).toBe("OGA-20261001-XXXX");
  });
});

describe("NewClientInputSchema", () => {
  const base = {
    idempotencyKey: KEY,
    businessName: "Sunset Roofing",
    ownerName: "Maria Lopez",
    ownerEmail: "owner@sunset.com",
    language: "es",
    vertical: "roofing",
    agentType: "ai_front_desk",
  };

  it("accepts the minimum and optional blanks", () => {
    expect(NewClientInputSchema.safeParse(base).success).toBe(true);
    expect(NewClientInputSchema.safeParse({ ...base, ownerPhone: "", website: "" }).success).toBe(true);
    expect(NewClientInputSchema.safeParse({ ...base, ownerPhone: "+1 (561) 555-0100", website: "sunset.com" }).success).toBe(true);
  });

  it("rejects bad keys, websites and phones", () => {
    expect(NewClientInputSchema.safeParse({ ...base, idempotencyKey: "abc" }).success).toBe(false);
    expect(NewClientInputSchema.safeParse({ ...base, website: "not a site" }).success).toBe(false);
    expect(NewClientInputSchema.safeParse({ ...base, ownerPhone: "call me" }).success).toBe(false);
    expect(NewClientInputSchema.safeParse({ ...base, agentType: "robot" }).success).toBe(false);
  });
});

describe("db error helpers", () => {
  it("recognize missing schema and unique violations", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumnError({ code: "23505" })).toBe(false);
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(isMissingTableError(null)).toBe(false);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
});
