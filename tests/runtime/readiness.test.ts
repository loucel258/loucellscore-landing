import { describe, it, expect } from "vitest";
import { checkReadiness } from "@/lib/agent-runtime/readiness";
import { toAgentConfig } from "@/lib/agent-runtime/config";
import { agentFixture } from "./helpers";
import type { ResolvedAgent } from "@/lib/agents/resolver";

const cfg = (over: Partial<ResolvedAgent> = {}) => toAgentConfig(agentFixture(over))!;
const keys = (r: ReturnType<typeof checkReadiness>) => r.missing.map((m) => `${m.channel}:${m.key}`);

describe("checkReadiness", () => {
  it("web: ready with slug, an allowed origin and a persona", () => {
    expect(checkReadiness(cfg(), { channels: ["web"] })).toEqual({ ready: true, missing: [] });
  });

  it("web: reports origins, persona and a missing booking link", () => {
    const r = checkReadiness(
      cfg({ allowedOrigins: ["not a url"], systemPrompt: "  ", toolsEnabled: ["request_booking"] }),
      { channels: ["web"] },
    );
    expect(r.ready).toBe(false);
    expect(keys(r)).toEqual(["web:allowed_origins", "web:persona", "web:booking_link"]);
    expect(r.missing.every((m) => m.message.length > 0 && !m.message.includes("—"))).toBe(true);
  });

  it("web: a configured https link (or a house agent) satisfies request_booking", () => {
    expect(
      keys(checkReadiness(cfg({ toolsEnabled: ["request_booking"], integrations: { booking: { link_url: "https://b.example" } } }), { channels: ["web"] })),
    ).toEqual([]);
    expect(keys(checkReadiness(cfg({ slug: "loucels-landing", toolsEnabled: ["request_booking"] }), { channels: ["web"] }))).toEqual([]);
  });

  it("sms: needs Twilio credentials, an E.164 sender, business hours and a timezone", () => {
    expect(keys(checkReadiness(cfg(), { channels: ["sms"] }))).toEqual([
      "sms:twilio_credential",
      "sms:sms_from_number",
      "sms:business_hours",
      "sms:timezone",
    ]);
    const ready = cfg({
      integrations: {
        sms: { from_number: "+15615550000" },
        booking: { business_hours: { mon: [9, 17] }, timezone: "America/New_York" },
      },
    });
    expect(checkReadiness(ready, { channels: ["sms"], twilioCredential: true })).toEqual({ ready: true, missing: [] });
    expect(keys(checkReadiness(cfg({ integrations: { sms: { from_number: "5615550000" } } }), { channels: ["sms"], twilioCredential: true }))).toContain(
      "sms:sms_from_number",
    );
  });

  it("only checks the channels asked for", () => {
    expect(checkReadiness(cfg({ systemPrompt: null }), { channels: ["sms"], twilioCredential: false }).missing.some((m) => m.channel === "web")).toBe(false);
  });
});
