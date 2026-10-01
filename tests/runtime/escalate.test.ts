import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTurnContext } from "@/lib/agent-runtime/context";
import { toAgentConfig } from "@/lib/agent-runtime/config";
import { agentFixture, fakeDeps, memoryStore, type MemoryStore } from "./helpers";

/**
 * escalate(): escalations row FIRST, then the alert. The table comes from
 * migration 060 (not written yet): a missing table must fall back to the
 * alert-only behavior, never break the hand-off.
 */

let store: MemoryStore;
beforeEach(() => {
  store = memoryStore();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function ctx(channel: "web" | "sms" = "sms") {
  const { deps } = fakeDeps(store, null);
  const c = createTurnContext(
    {
      channel,
      agent: toAgentConfig(agentFixture())!,
      conv: channel === "web" ? { kind: "session", sessionId: "s_12345678" } : { kind: "contact", contactId: "c1", phone: "+1" },
      text: "help",
      locale: "es",
      receivedAt: new Date(),
    },
    deps,
  );
  return { c, deps };
}

describe("escalate", () => {
  it("writes the row, then alerts", async () => {
    const { c } = ctx();
    const r = await c.escalate({ reason: "complaint", summary: "Unhappy <b>customer</b>" });
    expect(r).toEqual({ recorded: true, notified: true });
    expect(store.calls).toEqual(["insertEscalation", "sendAlert"]);
    expect(store.escalations[0]).toMatchObject({
      workspace_id: "ws_test",
      agent_slug: "test-agent",
      channel: "sms",
      contact_id: "c1",
      session_id: null,
      reason: "complaint",
    });
  });

  it("stores the summary DLP-masked", async () => {
    const { c } = ctx();
    await c.escalate({ reason: "complaint", summary: "Maria (maria@example.com, 4111 1111 1111 1111) wants a refund" });
    const stored = String(store.escalations[0]?.summary ?? "");
    expect(stored).not.toContain("maria@example.com");
    expect(stored).not.toContain("4111 1111 1111 1111");
    expect(stored).toContain("wants a refund");
  });

  it.each(["42P01", "PGRST205"])("table missing (%s) → no row, alert still sent", async (code) => {
    store.escalationError = { code, message: "relation \"escalations\" does not exist" };
    const { c, deps } = ctx("web");
    const r = await c.escalate({ reason: "agent_uncertain", summary: "x" });
    expect(r).toEqual({ recorded: false, notified: true });
    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
  });

  it("any other insert error or a throwing store still alerts", async () => {
    store.escalationError = { code: "42501", message: "permission denied" };
    const first = ctx();
    expect(await first.c.escalate({ reason: "x", summary: "y" })).toEqual({ recorded: false, notified: true });

    store.insertEscalation = async () => {
      throw new TypeError("sb.from is not a function");
    };
    const second = ctx();
    expect(await second.c.escalate({ reason: "x", summary: "y" })).toEqual({ recorded: false, notified: true });
  });

  it("alert not delivered → notified:false (copy must not promise a follow-up)", async () => {
    const { c, deps } = ctx();
    deps.sendAlert = vi.fn(async () => ({ ok: false as const, reason: "send_failed" as const }));
    expect(await c.escalate({ reason: "x", summary: "y" })).toEqual({ recorded: true, notified: false });
  });

  it("once per turn: a second escalation reuses the first", async () => {
    const { c, deps } = ctx();
    await c.escalate({ reason: "booking_backend_unavailable", summary: "y" });
    await c.escalate({ reason: "tool_loop_cap", summary: "y" });
    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
    expect(store.escalations).toHaveLength(1);
    expect(c.escalation?.reason).toBe("booking_backend_unavailable");
  });

  it("escapes customer text in the alert email", async () => {
    const { c, deps } = ctx();
    await c.escalate({ reason: "x", summary: "<script>alert(1)</script>" });
    const arg = (deps.sendAlert as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { bodyHtml: string };
    expect(arg.bodyHtml).not.toContain("<script>");
    expect(arg.bodyHtml).toContain("&lt;script&gt;");
  });
});
