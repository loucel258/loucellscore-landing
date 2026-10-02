import { describe, it, expect } from "vitest";
import type { WorkspaceMetrics } from "@/lib/metrics";
import {
  buildClientRows,
  buildPipeline,
  indexByWorkspace,
  isDemoWorkspace,
  isQuiet,
  legacyGroupKey,
  legacySiblings,
  type AccountInput,
  type AgentInput,
  type EngagementInput,
} from "@/lib/admin/client-list";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function m(sessions: number, lastAgoDays: number | null): WorkspaceMetrics {
  return {
    customerSessions: sessions,
    allowCount: sessions,
    denyCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    lastCustomerActivity: lastAgoDays === null ? null : iso(lastAgoDays * DAY),
  };
}

const accounts: AccountInput[] = [
  { id: "acc-naile", account_name: "Naile Studio", lifecycle: "active", vertical: "salon", primary_contact_email: "d@naile.com", updated_at: iso(5 * DAY) },
  { id: "acc-roof", account_name: "Sunset Roofing", lifecycle: "prospect", vertical: "roofing", primary_contact_email: "o@sunset.com", updated_at: iso(1 * DAY) },
  { id: "acc-house", account_name: "Loucells Core", lifecycle: "active", vertical: null, primary_contact_email: "s@lc.com", updated_at: iso(30 * DAY) },
];

const eng = (id: string, account_id: string | null, name: string, status: string, daysAgo: number): EngagementInput => ({
  id,
  account_id,
  engagement_ref: `REF-${id}`,
  client_legal_name: name,
  engagement_type: "smv_build",
  status,
  created_at: iso(daysAgo * DAY),
});

const engagements: EngagementInput[] = [
  eng("e-naile-1", "acc-naile", "Naile Studio", "delivered", 60),
  eng("e-naile-2", "acc-naile", "Naile Studio", "in_progress", 10),
  eng("e-roof", "acc-roof", "Sunset Roofing", "prospect_signed_up", 2),
  eng("e-house", "acc-house", "Loucells Core", "in_progress", 100),
  eng("e-old-1", null, "Old Dental ", "declined", 200),
  eng("e-old-2", null, "old  dental", "abandoned", 150),
];

const agent = (id: string, engagement_id: string, ws: string, extra: Partial<AgentInput> = {}): AgentInput => ({
  id,
  engagement_id,
  workspace_id: ws,
  slug: id,
  status: "live",
  monthly_retainer_cents: 0,
  retainer_active: false,
  minutes_saved_per_conversation: 6,
  ...extra,
});

const agents: AgentInput[] = [
  agent("naile-assistant", "e-naile-1", "ws_naile_1", { monthly_retainer_cents: 30_000, retainer_active: true }),
  agent("naile-sms", "e-naile-2", "ws_naile_2", { monthly_retainer_cents: 20_000, retainer_active: true, minutes_saved_per_conversation: 12 }),
  agent("old-archived", "e-naile-1", "ws_naile_old", { status: "archived", monthly_retainer_cents: 99_000, retainer_active: true }),
  agent("roof-bot", "e-roof", "ws_roof", { status: "designing" }),
  agent("loucels-landing", "e-house", "ws_house"),
];

const metrics = new Map<string, WorkspaceMetrics>([
  ["ws_naile_1", m(10, 3)],
  ["ws_naile_2", m(5, 1)],
  ["ws_roof", m(0, null)],
  ["ws_house", m(40, 0)],
]);

describe("buildClientRows", () => {
  const rows = buildClientRows({ accounts, engagements, agents, metrics, now: NOW });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  it("rolls every engagement and agent up to its account", () => {
    const naile = byKey.get("acc-naile")!;
    expect(naile.engagementIds).toEqual(["e-naile-2", "e-naile-1"]);
    expect(naile.workspaceIds.sort()).toEqual(["ws_naile_1", "ws_naile_2", "ws_naile_old"]);
    expect(naile.latestStatus).toBe("in_progress");
    expect(naile.agentCount).toBe(2); // archived excluded
    expect(naile.liveAgents).toBe(2);
  });

  it("uses the shared metrics: MRR skips archived, hours use each agent's minutes", () => {
    const naile = byKey.get("acc-naile")!;
    expect(naile.mrrCents).toBe(50_000);
    expect(naile.conversations30d).toBe(15);
    expect(naile.hoursSaved30d).toBeCloseTo((10 * 6) / 60 + (5 * 12) / 60);
    expect(naile.lastActivity).toBe(iso(1 * DAY));
    expect(naile.quiet).toBe(false);
  });

  it("groups account-less engagements by client name", () => {
    const legacy = rows.filter((r) => r.kind === "legacy");
    expect(legacy).toHaveLength(1);
    expect(legacy[0]!.engagementIds).toEqual(["e-old-2", "e-old-1"]);
    expect(legacy[0]!.lifecycle).toBeNull();
    expect(legacy[0]!.href).toBe("/admin/clients/e/e-old-2");
    expect(legacy[0]!.key).toBe(`legacy:${legacyGroupKey("Old Dental")}`);
  });

  it("flags the house agent and links accounts", () => {
    expect(byKey.get("acc-house")!.isHouse).toBe(true);
    expect(byKey.get("acc-naile")!.isHouse).toBe(false);
    expect(byKey.get("acc-roof")!.href).toBe("/admin/clients/acc-roof");
  });

  it("sorts active first, then by MRR", () => {
    expect(rows.map((r) => r.key)).toEqual(["acc-naile", "acc-house", "acc-roof", rows[3]!.key]);
    expect(rows[3]!.kind).toBe("legacy");
  });

  it("indexes workspaces back to their client", () => {
    const idx = indexByWorkspace(rows);
    expect(idx.get("ws_naile_2")!.key).toBe("acc-naile");
    expect(idx.get("ws_roof")!.key).toBe("acc-roof");
  });
});

describe("demo workspaces", () => {
  it("recognizes the Trust Stack demo prefix only", () => {
    expect(isDemoWorkspace("ws_demo_001")).toBe(true);
    expect(isDemoWorkspace("ws_demo_hitl")).toBe(true);
    expect(isDemoWorkspace("ws_client_demo_20260606_acme_loucels_landing")).toBe(false);
    expect(isDemoWorkspace("ws_naile_1")).toBe(false);
    expect(isDemoWorkspace(null)).toBe(false);
  });

  it("never counts a demo workspace agent toward a client", () => {
    const withDemo = [
      ...agents,
      agent("demo-bot", "e-naile-2", "ws_demo_001", { monthly_retainer_cents: 77_000, retainer_active: true }),
    ];
    const demoMetrics = new Map(metrics).set("ws_demo_001", m(99, 0));
    const rows = buildClientRows({ accounts, engagements, agents: withDemo, metrics: demoMetrics, now: NOW });
    const naile = rows.find((r) => r.key === "acc-naile")!;
    expect(naile.workspaceIds).not.toContain("ws_demo_001");
    expect(naile.mrrCents).toBe(50_000);
    expect(naile.conversations30d).toBe(15);
    expect(naile.liveAgents).toBe(2);
    expect(indexByWorkspace(rows).has("ws_demo_001")).toBe(false);
  });
});

describe("isQuiet", () => {
  it("only flags paying clients without recent conversations", () => {
    expect(isQuiet(0, null, NOW)).toBe(false);
    expect(isQuiet(10_000, null, NOW)).toBe(true);
    expect(isQuiet(10_000, iso(13 * DAY), NOW)).toBe(false);
    expect(isQuiet(10_000, iso(15 * DAY), NOW)).toBe(true);
  });
});

describe("legacySiblings", () => {
  it("matches same-name account-less engagements only", () => {
    const sibs = legacySiblings(engagements[4]!, engagements);
    expect(sibs.map((e) => e.id)).toEqual(["e-old-1", "e-old-2"]);
  });
});

describe("buildPipeline", () => {
  it("drops empty lanes and names cards after the account", () => {
    const lanes = buildPipeline(engagements, new Map(accounts.map((a) => [a.id, a.account_name])));
    expect(lanes.map((l) => l.key)).toEqual(["prospect", "working", "delivered", "lost"]);
    const working = lanes.find((l) => l.key === "working")!;
    expect(working.cards.map((c) => c.engagementId)).toEqual(["e-naile-2", "e-house"]);
    const lost = lanes.find((l) => l.key === "lost")!;
    expect(lost.cards[0]!.href).toBe("/admin/clients/e/e-old-2");
    expect(lost.cards[0]!.clientName).toBe("old  dental");
  });
});
