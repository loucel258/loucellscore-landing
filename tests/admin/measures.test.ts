import { describe, it, expect } from "vitest";
import { buildNeedsYou, SILENT_CRITICAL_DAYS, type ClientRef } from "@/lib/admin/needs-you";
import { clientChannelChips, describeChannels, missingSmsPhrase } from "@/lib/admin/health";
import { budgetUse, currentMonthKey, formatTokens, isBudgetWarning } from "@/lib/admin/usage";
import { paymentSummary } from "@/lib/admin/payments";
import { portalVisitFor } from "@/lib/admin/client-extras";
import { rollupAgents, type AgentInput } from "@/lib/admin/client-list";
import { ADMIN_KNOWN_CRONS } from "@/lib/admin/crons";
import type { AgentServiceStatus } from "@/lib/service-status";
import type { WorkspaceMetrics } from "@/lib/metrics";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const naile = { kind: "account" as const, accountId: "acc-naile" };

function needs(extra: Partial<Parameters<typeof buildNeedsYou>[0]>) {
  return buildNeedsYou({
    now: NOW,
    dueTasks: [],
    approvals: [],
    clientsByWorkspace: new Map<string, ClientRef>(),
    quietClients: [],
    failedCrons: [],
    escalations: null,
    ...extra,
  });
}

describe("Needs you: live agents with no traffic", () => {
  it("flags a never-used live agent, paying or not, linking to its Setup", () => {
    const [item] = needs({
      silentAgents: [
        { agentId: "agent-1", agentName: "Naile assistant", clientName: "Naile Studio", scope: naile, days: 97, neverHadTraffic: true, webOn: true },
      ],
    });
    expect(item).toMatchObject({
      id: "silent:agent-1",
      kind: "silent",
      tone: "critical",
      title: "Naile assistant: live 97 days, no customer conversations",
      detail: "Is the chat installed on Naile Studio's site?",
      href: "/admin/clients/acc-naile?tab=setup&agent=agent-1#agent-agent-1",
    });
  });

  it("is an attention item under 30 days and words a lapse differently", () => {
    const [item] = needs({
      silentAgents: [
        { agentId: "a2", agentName: "Spa bot", clientName: "Spa", scope: null, days: 9, neverHadTraffic: false, webOn: false },
      ],
    });
    expect(SILENT_CRITICAL_DAYS).toBe(30);
    expect(item).toMatchObject({
      tone: "attention",
      title: "Spa bot: no customer conversations in 9 days",
      detail: "Spa: check the text number and the booking setup.",
      href: "/admin/clients",
    });
  });

  it("does not also say 'gone quiet' for the same client", () => {
    const items = needs({
      quietClients: [
        { key: "acc-naile", name: "Naile Studio", scope: naile, lastActivity: null },
        { key: "acc-other", name: "Other", scope: { kind: "account", accountId: "acc-other" }, lastActivity: null },
      ],
      silentAgents: [
        { agentId: "agent-1", agentName: "Naile assistant", clientName: "Naile Studio", scope: naile, days: 12, neverHadTraffic: true, webOn: true },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(["silent:agent-1", "quiet:acc-other"]);
  });
});

describe("Needs you: budget and reports", () => {
  it("warns at 80% and is urgent at 100%", () => {
    const items = needs({
      budgetWarnings: [
        { agentId: "a1", agentName: "Naile assistant", scope: naile, share: 0.86 },
        { agentId: "a2", agentName: "Spa bot", scope: null, share: 1.02 },
      ],
    });
    expect(items.map((i) => [i.id, i.tone, i.title])).toEqual([
      ["budget:a2", "critical", "Spa bot: 102% of this month's token budget used"],
      ["budget:a1", "attention", "Naile assistant: 86% of this month's token budget used"],
    ]);
  });

  it("counts weekly reports waiting for review", () => {
    expect(needs({ reportsWaiting: 3 })[0]).toMatchObject({
      kind: "reports",
      title: "3 weekly reports waiting for review",
      href: "/admin/reports",
    });
    expect(needs({ reportsWaiting: 1 })[0]!.title).toBe("1 weekly report waiting for review");
    expect(needs({ reportsWaiting: 0 })).toEqual([]);
    expect(needs({ reportsWaiting: null })).toEqual([]);
  });
});

const status = (over: Partial<AgentServiceStatus> = {}): AgentServiceStatus => ({
  agentId: "a",
  slug: "a",
  status: "live",
  web: { state: "active", lastCustomerAt: null },
  sms: { state: "off", credentials: false, fromNumber: false, lastInboundAt: null },
  reminders: { state: "off", lastSentAt: null, sent30d: 0 },
  phone: { state: "off", provider: "twilio_cr", missing: [], lastCallAt: null, calls30d: 0 },
  booking: { mode: "none", linkConfigured: false, backendCredential: false, state: "off" },
  lastCustomerAt: null,
  noTrafficDays: null,
  ...over,
});

describe("health in plain words", () => {
  it("explains each channel", () => {
    const lines = describeChannels(
      status({
        web: { state: "active", lastCustomerAt: "2026-09-28T12:00:00Z" },
        sms: { state: "attention", credentials: true, fromNumber: false, lastInboundAt: null },
        reminders: { state: "active", lastSentAt: "2026-10-01T09:00:00Z", sent30d: 14 },
        booking: { mode: "external", linkConfigured: false, backendCredential: false, state: "attention" },
      }),
      NOW,
    );
    expect(lines.map((l) => [l.label, l.stateLabel, l.detail])).toEqual([
      ["Web chat", "Working", "Last customer chat 3d ago"],
      ["Text messages", "Needs setup", "Switched on, but the sending number is missing"],
      ["Phone calls", "Off", "Not set up"],
      ["Reminders", "Working", "Last sent 3h ago, 14 in the last 30 days"],
      ["Booking", "Needs setup", "Set to the client's booking app, but its key is missing"],
    ]);
  });

  it("explains the phone line: working, and what is missing", () => {
    const phone = (p: Partial<AgentServiceStatus["phone"]>) =>
      describeChannels(status({ phone: { state: "off", provider: "twilio_cr", missing: [], lastCallAt: null, calls30d: 0, ...p } }), NOW).find(
        (l) => l.key === "phone",
      )!;
    expect(phone({ state: "active", lastCallAt: "2026-10-01T09:00:00Z", calls30d: 4 }).detail).toBe(
      "Last call 3h ago, 4 in the last 30 days (Twilio)",
    );
    expect(phone({ state: "attention", missing: ["twilio_keys", "gateway"] }).detail).toBe(
      "Switched on, but the Twilio keys are missing and the voice gateway is not configured (VOICE_GATEWAY_URL / VOICE_GATEWAY_SECRET)",
    );
  });

  it("says when a live web chat never had a customer", () => {
    expect(describeChannels(status(), NOW)[0]!.detail).toBe("Live, but no customer has chatted yet");
  });

  it("missing SMS parts read correctly", () => {
    expect(missingSmsPhrase({ sms: { state: "attention", credentials: false, fromNumber: false, lastInboundAt: null } })).toBe(
      "the Twilio keys and the sending number are missing",
    );
    expect(missingSmsPhrase({ sms: { state: "attention", credentials: false, fromNumber: true, lastInboundAt: null } })).toBe(
      "the Twilio keys are missing",
    );
  });

  it("client chips: needs-setup wins, off channels are hidden", () => {
    const chips = clientChannelChips([
      status({ sms: { state: "pending", credentials: true, fromNumber: false, lastInboundAt: null } }),
      status({ web: { state: "attention", lastCustomerAt: null } }),
    ]);
    expect(chips).toEqual([
      { key: "web", label: "Web", state: "attention" },
      { key: "sms", label: "SMS", state: "pending" },
    ]);
  });
});

describe("usage vs budget", () => {
  it("computes the share and the warning", () => {
    expect(budgetUse(1_700_000, 2_000_000)).toEqual({ used: 1_700_000, budget: 2_000_000, share: 0.85 });
    expect(isBudgetWarning(budgetUse(1_600_000, 2_000_000))).toBe(true);
    expect(isBudgetWarning(budgetUse(1_500_000, 2_000_000))).toBe(false);
    expect(budgetUse(5, 0).share).toBeNull(); // 0 = unlimited
    expect(isBudgetWarning(budgetUse(5_000_000, 0))).toBe(false);
  });
  it("month key and token formatting", () => {
    expect(currentMonthKey(new Date("2026-10-31T23:59:00Z"))).toBe("2026-10-01");
    expect(formatTokens(1_234_567)).toBe("1.2M");
    expect(formatTokens(850_400)).toBe("850K");
    expect(formatTokens(312)).toBe("312");
  });
});

describe("payments from the Stripe webhook", () => {
  it("shows the latest payment and failures without trusting the failed amount", () => {
    const base = { stripe_paid_at: null, stripe_amount_paid_cents: null, outcome_at: null, created_at: "2026-06-01" };
    const s = paymentSummary([
      { ...base, engagement_ref: "GAP-1", engagement_type: "gap_audit", status: "delivered", stripe_paid_at: "2026-06-03T10:00:00Z", stripe_amount_paid_cents: 50000 },
      { ...base, engagement_ref: "BLD-1", engagement_type: "smv_build", status: "payment_failed", stripe_amount_paid_cents: 250000, outcome_at: "2026-07-01T10:00:00Z" },
    ]);
    expect(s.lastPaid).toEqual({ at: "2026-06-03T10:00:00Z", cents: 50000, ref: "GAP-1", type: "gap_audit" });
    expect(s.failed).toEqual([{ ref: "BLD-1", type: "smv_build", at: "2026-07-01T10:00:00Z" }]);
    expect(paymentSummary([])).toEqual({ lastPaid: null, failed: [] });
  });
});

describe("portal adoption", () => {
  it("sums usable portals and keeps the latest visit", () => {
    const rows = [
      { engagement_id: "e1", last_login_at: "2026-09-20T00:00:00Z", login_count: 3, active: true, revoked_at: null },
      { engagement_id: "e1", last_login_at: "2026-09-28T00:00:00Z", login_count: 1, active: true, revoked_at: null },
      { engagement_id: "e1", last_login_at: "2026-09-30T00:00:00Z", login_count: 9, active: true, revoked_at: "2026-09-30T01:00:00Z" },
      { engagement_id: "e2", last_login_at: null, login_count: 0, active: true, revoked_at: null },
    ];
    expect(portalVisitFor(["e1"], rows)).toEqual({ portals: 2, lastLoginAt: "2026-09-28T00:00:00Z", loginCount: 4 });
    expect(portalVisitFor(["e2"], rows)).toEqual({ portals: 1, lastLoginAt: null, loginCount: 0 });
    expect(portalVisitFor(["e3"], rows)).toEqual({ portals: 0, lastLoginAt: null, loginCount: 0 });
  });
});

describe("conversation counts match the portal", () => {
  const agent = (ws: string, minutes: number | null): AgentInput => ({
    id: ws,
    engagement_id: "e",
    workspace_id: ws,
    slug: ws,
    status: "live",
    monthly_retainer_cents: 0,
    retainer_active: false,
    minutes_saved_per_conversation: minutes,
  });
  const m = (sessions: number, last: string | null): WorkspaceMetrics => ({
    customerSessions: sessions,
    allowCount: 0,
    denyCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    lastCustomerActivity: last,
  });

  it("uses conversation-stats counts when given, metrics otherwise, last activity from metrics", () => {
    const metrics = new Map([
      ["ws1", m(4, "2026-09-30T00:00:00Z")],
      ["ws2", m(2, null)],
    ]);
    const r = rollupAgents([agent("ws1", 6), agent("ws2", null)], metrics, new Map([["ws1", 10]]));
    expect(r.conversations).toBe(12); // 10 (web + SMS) + 2 (fallback)
    expect(r.hours).toBeCloseTo((10 * 6) / 60 + (2 * 5) / 60);
    expect(r.lastActivity).toBe("2026-09-30T00:00:00Z");
    expect(rollupAgents([agent("ws1", 6)], metrics).conversations).toBe(4);
  });
});

describe("admin cron list", () => {
  it("includes the weekly drafter once", () => {
    expect(ADMIN_KNOWN_CRONS.filter((c) => c.job === "weekly-reports")).toEqual([
      { job: "weekly-reports", label: "Weekly client reports (drafts only)", schedule: "0 13 * * 1" },
    ]);
  });
});
