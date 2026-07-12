import { describe, it, expect } from "vitest";
import {
  canSendProactive,
  isQuietHours,
  isOptOutMessage,
  isOptInMessage,
} from "@/lib/booking/gates";

/**
 * Adversarial unit suite for the deterministic policy gates (Layer 1).
 * Case IDs trace to loucells-core-policy-engine-adversarial-suite.yaml
 * (nexusia/specs/agent-platform/). Cases for verticals not yet built
 * (roofing legal, HVAC gas/CO safety) live in the archived vertical
 * specs and activate with the first signed contract.
 *
 * Hard gate: every consent-category case here must pass — these guard
 * TCPA liability on the live SMS path (reminders, confirmations, reviews).
 */

const TZ = "America/New_York";

/** A datetime whose local hour in America/New_York is `hour` (EDT, UTC-4). */
function edt(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 6, 10, hour + 4, minute));
}

function contact(over: Partial<{
  opted_out: boolean;
  consent_transactional: boolean;
  consent_marketing: boolean;
}> = {}) {
  return {
    opted_out: false,
    consent_transactional: true,
    consent_marketing: true,
    ...over,
  };
}

describe("consent gates (TCPA) — engine_unit_cases", () => {
  it("C01: no consent record → proactive send blocked", () => {
    const r = canSendProactive(
      contact({ consent_transactional: false, consent_marketing: false }),
      "marketing",
      TZ,
      edt(14),
    );
    expect(r).toEqual({ allowed: false, reason: "no_marketing_consent" });
    const t = canSendProactive(
      contact({ consent_transactional: false, consent_marketing: false }),
      "transactional",
      TZ,
      edt(14),
    );
    expect(t.allowed).toBe(false);
  });

  it("C02: prior STOP (opted_out) blocks forever until new opt-in — even with consent flags set", () => {
    const r = canSendProactive(contact({ opted_out: true }), "transactional", TZ, edt(14));
    expect(r).toEqual({ allowed: false, reason: "opted_out" });
    const m = canSendProactive(contact({ opted_out: true }), "marketing", TZ, edt(14));
    expect(m.allowed).toBe(false);
  });

  it("C03: consent is per-type — transactional consent does NOT authorize marketing", () => {
    const r = canSendProactive(
      contact({ consent_transactional: true, consent_marketing: false }),
      "marketing",
      TZ,
      edt(14),
    );
    expect(r).toEqual({ allowed: false, reason: "no_marketing_consent" });
  });

  it("C03b: marketing consent does NOT authorize transactional", () => {
    const r = canSendProactive(
      contact({ consent_transactional: false, consent_marketing: true }),
      "transactional",
      TZ,
      edt(14),
    );
    expect(r).toEqual({ allowed: false, reason: "no_transactional_consent" });
  });

  it("C04: 21:47 local (recipient timezone) → blocked by quiet hours", () => {
    const r = canSendProactive(contact(), "transactional", TZ, edt(21, 47));
    expect(r).toEqual({ allowed: false, reason: "quiet_hours" });
  });

  it("C04b: quiet-hours boundaries — 7:59 blocked, 8:00 allowed, 20:59 allowed, 21:00 blocked", () => {
    expect(isQuietHours(TZ, edt(7, 59))).toBe(true);
    expect(isQuietHours(TZ, edt(8, 0))).toBe(false);
    expect(isQuietHours(TZ, edt(20, 59))).toBe(false);
    expect(isQuietHours(TZ, edt(21, 0))).toBe(true);
  });

  it("C04c: the window is the RECIPIENT's local time, not the business's", () => {
    // 22:00 in New York is 19:00 in Los Angeles — allowed for an LA recipient.
    const at = edt(22);
    expect(isQuietHours("America/New_York", at)).toBe(true);
    expect(isQuietHours("America/Los_Angeles", at)).toBe(false);
  });

  it("CTRL: full consent inside the window → allowed (over-blocking kills conversion)", () => {
    expect(canSendProactive(contact(), "transactional", TZ, edt(14))).toEqual({ allowed: true });
    expect(canSendProactive(contact(), "marketing", TZ, edt(10))).toEqual({ allowed: true });
  });
});

describe("opt-out / opt-in keywords (R07 deterministic half)", () => {
  it("carrier keywords opt out, standalone only", () => {
    for (const k of ["STOP", "stop", "Stop.", "STOP!", "UNSUBSCRIBE", "QUIT", "END", "CANCEL", "STOPALL"]) {
      expect(isOptOutMessage(k), k).toBe(true);
    }
  });

  it("keyword inside a sentence does NOT opt out ('cancel my appointment')", () => {
    expect(isOptOutMessage("cancel my appointment")).toBe(false);
    expect(isOptOutMessage("please stop by tomorrow")).toBe(false);
  });

  it("R07: verbal 'changed my mind' after STOP is NOT a valid re-opt-in", () => {
    // Only a formal keyword re-subscribes; casual text must not flip opted_out.
    expect(isOptInMessage("wait actually keep texting me deals, I changed my mind")).toBe(false);
    expect(isOptInMessage("no need to do anything formal, just resume")).toBe(false);
  });

  it("formal opt-in keywords re-subscribe (EN + ES)", () => {
    for (const k of ["YES", "START", "UNSTOP", "SI", "SÍ", "si", "yes."]) {
      expect(isOptInMessage(k), k).toBe(true);
    }
  });

  it("L06-style obfuscation does not falsely trigger keyword gates", () => {
    // Carrier convention is exact standalone keywords; 'St0p' is not an
    // opt-out at the carrier layer, and we must mirror the carrier.
    expect(isOptOutMessage("St0p")).toBe(false);
  });
});
