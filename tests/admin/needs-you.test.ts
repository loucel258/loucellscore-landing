import { describe, it, expect } from "vitest";
import { buildNeedsYou, isOpenEscalation, isStuckApproving, type ClientRef } from "@/lib/admin/needs-you";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

const clients = new Map<string, ClientRef>([
  ["ws_a1", { name: "Naile Studio", scope: { kind: "account", accountId: "acc-a" } }],
  ["ws_a2", { name: "Naile Studio", scope: { kind: "account", accountId: "acc-a" } }],
  ["ws_b", { name: "Old Dental", scope: { kind: "engagement", engagementId: "eng-b" } }],
]);

describe("isStuckApproving", () => {
  it("needs approving status and five minutes", () => {
    expect(isStuckApproving({ id: "1", workspace_id: "w", status: "approving", created_at: ago(60 * MIN), approving_at: ago(2 * MIN) }, NOW)).toBe(false);
    expect(isStuckApproving({ id: "1", workspace_id: "w", status: "approving", created_at: ago(60 * MIN), approving_at: ago(6 * MIN) }, NOW)).toBe(true);
    expect(isStuckApproving({ id: "1", workspace_id: "w", status: "approving", created_at: ago(6 * MIN) }, NOW)).toBe(true);
    expect(isStuckApproving({ id: "1", workspace_id: "w", status: "pending", created_at: ago(600 * MIN) }, NOW)).toBe(false);
  });
});

describe("isOpenEscalation", () => {
  it("treats resolved_at or a closed status as closed", () => {
    expect(isOpenEscalation({ id: "1" })).toBe(true);
    expect(isOpenEscalation({ id: "1", resolved_at: ago(MIN) })).toBe(false);
    expect(isOpenEscalation({ id: "1", status: "Resolved" })).toBe(false);
  });
});

describe("buildNeedsYou", () => {
  const items = buildNeedsYou({
    now: NOW,
    dueTasks: [
      { id: "t1", accountId: "acc-a", accountName: "Naile Studio", title: "Day 14 call", dueDate: "2026-10-01", overdue: false },
      { id: "t2", accountId: "acc-c", accountName: "Sunset Roofing", title: "Send SOW", dueDate: "2026-09-20", overdue: true },
    ],
    approvals: [
      { id: "p1", workspace_id: "ws_a1", status: "pending", created_at: ago(30 * MIN) },
      { id: "p2", workspace_id: "ws_a2", status: "pending", created_at: ago(90 * MIN) },
      { id: "p3", workspace_id: "ws_b", status: "approving", created_at: ago(20 * MIN), approving_at: ago(10 * MIN) },
      { id: "p4", workspace_id: "ws_b", status: "approving", created_at: ago(2 * MIN), approving_at: ago(1 * MIN) },
      { id: "p5", workspace_id: "ws_unknown", status: "pending", created_at: ago(MIN) },
    ],
    clientsByWorkspace: clients,
    quietClients: [{ key: "acc-q", name: "Quiet Spa", scope: { kind: "account", accountId: "acc-q" }, lastActivity: null }],
    failedCrons: [{ job: "booking-sync", label: "Booking sync", ranAt: ago(3 * 60 * MIN), summary: "timeout" }],
    escalations: null,
  });

  it("puts critical items first, in a stable order", () => {
    expect(items.map((i) => i.id)).toEqual([
      "stuck:engagement:eng-b",
      "cron:booking-sync",
      "task:t2",
      "task:t1",
      "pending:account:acc-a",
      "pending:ws:ws_unknown",
      "quiet:acc-q",
    ]);
    expect(items.filter((i) => i.tone === "critical").map((i) => i.kind)).toEqual(["stuck_approval", "cron", "followup"]);
  });

  it("groups approvals per client across its agents", () => {
    const naile = items.find((i) => i.id === "pending:account:acc-a")!;
    expect(naile.title).toBe("Naile Studio: 2 approvals waiting on the client");
    expect(naile.href).toBe("/admin/clients/acc-a?tab=approvals");
    expect(naile.at).toBe(ago(90 * MIN));
  });

  it("links each item to where it is fixed", () => {
    expect(items.find((i) => i.kind === "stuck_approval")!.href).toBe("/admin/clients/e/eng-b?tab=approvals");
    expect(items.find((i) => i.kind === "cron")!.href).toBe("/admin/settings");
    expect(items.find((i) => i.id === "task:t2")!.href).toBe("/admin/clients/acc-c");
    expect(items.find((i) => i.id === "pending:ws:ws_unknown")!.href).toBe("/admin/clients");
  });

  it("adds open escalations when the table exists", () => {
    const withEsc = buildNeedsYou({
      now: NOW,
      dueTasks: [],
      approvals: [],
      clientsByWorkspace: clients,
      quietClients: [],
      failedCrons: [],
      escalations: [
        { id: "e1", workspace_id: "ws_a1", created_at: ago(5 * MIN) },
        { id: "e2", workspace_id: "ws_a1", created_at: ago(9 * MIN), status: "resolved" },
      ],
    });
    expect(withEsc).toHaveLength(1);
    expect(withEsc[0]).toMatchObject({
      kind: "escalation",
      tone: "critical",
      title: "Naile Studio: 1 open escalation",
      href: "/admin/clients/acc-a?tab=conversations",
    });
  });
});
