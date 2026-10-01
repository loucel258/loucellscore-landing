import { describe, it, expect } from "vitest";
import { buildPrompt } from "@/lib/agent-runtime/steps/prompt";
import { toAgentConfig } from "@/lib/agent-runtime/config";
import { webTools } from "@/lib/agent-runtime/tools/web";
import { smsTools } from "@/lib/agent-runtime/tools/booking";
import { buildAgentSystemPrompt, safetyRules } from "@/lib/agents/safety-prompt";
import { agentFixture } from "./helpers";

describe("buildPrompt", () => {
  it("web: identical to the prompt live agents had before the runtime", () => {
    for (const locale of ["en", "es"] as const) {
      for (const over of [
        {},
        { systemPrompt: null, greetingMessage: "Hola!" },
        { toolsEnabled: ["escalate_to_human", "request_human_approval"], integrations: { kb: "FAQ", vertical: "salon" } },
      ]) {
        const agent = agentFixture(over);
        const config = toAgentConfig(agent)!;
        const tools = webTools(config);
        const before = buildAgentSystemPrompt({ ...agent, toolsEnabled: tools.map((t) => t.tool.name) }, locale);
        expect(buildPrompt({ config, channel: "web", locale, tools })).toEqual({ system: before });
      }
    }
  });

  it("sms: safety first, then vertical, persona, KB, SMS format rules, services + hours", () => {
    const config = toAgentConfig(
      agentFixture({
        vertical: "nail salon",
        integrations: { kb: "Parking in the back.", booking: { business_hours: { mon: [9, 17.5] }, timezone: "America/Chicago" } },
      }),
    )!;
    const { system, dynamic } = buildPrompt({
      config,
      channel: "sms",
      locale: "es",
      tools: smsTools(),
      services: [{ id: "svc_gel", name: "Gel", duration_min: 60, price_cents: 4500 }],
    });
    const at = (s: string) => system.indexOf(s);
    expect(system.startsWith(safetyRules("en"))).toBe(true);
    expect(at("a nail salon")).toBeGreaterThan(at("ACTION CONTRACT (SMS)"));
    expect(at("<persona>")).toBeGreaterThan(at("a nail salon"));
    expect(at("Parking in the back.")).toBeGreaterThan(at("</persona>"));
    expect(at("plain text only")).toBeGreaterThan(at("Parking in the back."));
    expect(system).toMatch(/No markdown/);
    expect(system).toContain("- Gel (id: svc_gel, 60 min, $45)");
    expect(system).toContain("Mon 9:00-17:30");
    expect(system).toContain("Timezone: America/Chicago.");
    // Tool policies drive the action contract.
    expect(system).toMatch(/create_appointment, reschedule_appointment, cancel_appointment: change something real/);
    expect(dynamic).toMatch(/^Current local time: /);
  });

  it("sms: generic vertical has no salon wording", () => {
    const { system } = buildPrompt({
      config: toAgentConfig(agentFixture({ vertical: "roofing" }))!,
      channel: "sms",
      locale: "en",
      tools: smsTools(),
    });
    expect(system).toContain("a local business");
    expect(system).not.toMatch(/nail/i);
  });
});
