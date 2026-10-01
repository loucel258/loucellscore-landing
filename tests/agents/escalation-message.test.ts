import { describe, it, expect } from "vitest";
import { handleEscalateToHuman } from "@/lib/chat/tools";

const REASONS = [
  "out_of_scope",
  "sensitive_topic",
  "frustrated_visitor",
  "ambiguous_high_stakes",
  "agent_uncertain",
] as const;

describe("handleEscalateToHuman", () => {
  it("never names Loucells' founder in a client agent's reply", () => {
    for (const reason of REASONS) {
      for (const locale of ["en", "es"] as const) {
        const { acknowledgement } = handleEscalateToHuman(
          { reason, summary: "x", email: "a@b.com" },
          locale,
        );
        expect(acknowledgement).not.toMatch(/steven|founder|business day|día hábil/i);
      }
    }
  });

  it("names Steven only for the house agent", () => {
    const { acknowledgement } = handleEscalateToHuman(
      { reason: "out_of_scope", summary: "x", email: "a@b.com" },
      "en",
      { house: true },
    );
    expect(acknowledgement).toContain("Steven");
  });

  it("asks for contact info when the visitor left none", () => {
    expect(
      handleEscalateToHuman({ reason: "agent_uncertain", summary: "x" }, "es").acknowledgement,
    ).toMatch(/email o tu teléfono/);
    expect(
      handleEscalateToHuman({ reason: "agent_uncertain", summary: "x", email: "a@b.com" }, "en")
        .acknowledgement,
    ).not.toMatch(/email or phone/);
  });

  it("has no em dashes in any reply", () => {
    for (const reason of REASONS) {
      for (const locale of ["en", "es"] as const) {
        for (const house of [true, false]) {
          const { acknowledgement } = handleEscalateToHuman({ reason, summary: "x" }, locale, { house });
          expect(acknowledgement).not.toContain("—");
        }
      }
    }
  });
});
