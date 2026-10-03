import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSb, type FakeSb } from "../reports/fake-sb";
import {
  diffSnapshots,
  lineDiff,
  restoreInputFromSnapshot,
  scrubSecrets,
  snapshotFromRow,
  type ConfigSnapshot,
} from "@/lib/admin/config-versions";

const state: { authed: boolean; sb: FakeSb | null } = { authed: true, sb: null };
const audits: Array<{ reason: string; workspace_id: string }> = [];

vi.mock("@/lib/admin/auth", () => ({ isAdminAuthed: async () => state.authed }));
vi.mock("@/lib/audit/client", () => ({ getServiceClient: () => state.sb }));
vi.mock("@/lib/agents/resolver", () => ({
  canonicalizeOrigin: (o: string) => o,
  invalidateAgentCache: () => {},
}));
vi.mock("@/lib/audit/writer", () => ({
  writeAuditEntry: async (e: { reason: string; workspace_id: string }) => {
    audits.push(e);
    return { ok: true };
  },
}));

import { POST } from "@/app/api/admin/agents/[id]/update/route";
import { GET } from "@/app/api/admin/agents/[id]/versions/route";

const AGENT_ID = "44444444-4444-4444-8444-444444444444";

const agentRow = (over: Record<string, unknown> = {}) => ({
  id: AGENT_ID,
  slug: "naile-assistant",
  workspace_id: "ws_naile",
  engagement_id: "eng-1",
  name: "Naile assistant",
  agent_type: "ai_front_desk",
  channels: ["chat_widget"],
  tools_enabled: ["request_booking"],
  greeting_message: "Welcome",
  max_tokens_per_message: 1024,
  status: "live",
  system_prompt: "You are the front desk.\nBe brief.",
  allowed_origins: ["https://naile.example.com"],
  shadow_mode_started_at: null,
  uat_started_at: null,
  live_started_at: null,
  archived_at: null,
  integrations: { booking: { mode: "link", link_url: "https://book.example.com/n" }, kb: "Policies" },
  monthly_retainer_cents: 0,
  retainer_active: false,
  minutes_saved_per_conversation: 5,
  ...over,
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: AGENT_ID }) },
  );

const versionInserts = (sb: FakeSb) =>
  sb.inserts.filter((i) => i.table === "agent_config_versions").map((i) => i.row as Record<string, unknown>);

beforeEach(() => {
  state.authed = true;
  state.sb = null;
  audits.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("snapshots and diffs", () => {
  it("scrubSecrets drops secret-looking keys at any depth", () => {
    expect(
      scrubSecrets({ a: 1, api_key: "x", nested: { access_token: "t", ok: true, list: [{ webhook_secret: "s", n: 1 }] } }),
    ).toEqual({ a: 1, nested: { ok: true, list: [{ n: 1 }] } });
  });

  it("snapshotFromRow: sorted lists, no secrets, empty persona = null", () => {
    const s = snapshotFromRow({
      name: "A",
      system_prompt: "",
      greeting_message: null,
      tools_enabled: ["b", "a"],
      allowed_origins: ["https://z.com", "https://a.com"],
      integrations: { whatsapp: { auth_token: "no", from_number: "+1" } },
    });
    expect(s.tools_enabled).toEqual(["a", "b"]);
    expect(s.allowed_origins).toEqual(["https://a.com", "https://z.com"]);
    expect(s.system_prompt).toBeNull();
    expect(s.integrations).toEqual({ whatsapp: { from_number: "+1" } });
  });

  it("diffSnapshots names what moved, one level into integrations; key order is not a change", () => {
    const a = snapshotFromRow(agentRow() as never);
    const b = snapshotFromRow({
      ...agentRow(),
      system_prompt: "New persona",
      integrations: { kb: "Policies", booking: { link_url: "https://book.example.com/n", mode: "link", timezone: "America/Chicago" } },
    });
    expect(diffSnapshots(a, b).map((d) => d.field)).toEqual(["system_prompt", "integrations.booking.timezone"]);
    expect(diffSnapshots(a, a)).toEqual([]);
  });

  it("lineDiff: same / add / del in order", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc\nd")).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "x" },
      { type: "same", text: "c" },
      { type: "add", text: "d" },
    ]);
    expect(lineDiff("", "hello")).toEqual([{ type: "add", text: "hello" }]);
  });

  it("restoreInputFromSnapshot only emits fields the update route accepts", () => {
    const snap = snapshotFromRow(agentRow() as never);
    const input = restoreInputFromSnapshot(snap);
    expect(input).toMatchObject({
      systemPrompt: "You are the front desk.\nBe brief.",
      greetingMessage: "Welcome",
      toolsEnabled: ["request_booking"],
      allowedOrigins: ["https://naile.example.com"],
      maxTokensPerMessage: 1024,
      integrations: { booking: { link_url: "https://book.example.com/n", business_hours: null, timezone: null } },
    });
    expect(JSON.stringify(input)).not.toContain("Policies"); // kb is not restorable
  });

  it("restores phone settings but never the Vapi secret", () => {
    const row = agentRow() as Record<string, unknown>;
    const snap = snapshotFromRow({
      ...row,
      integrations: {
        ...((row.integrations as Record<string, unknown>) ?? {}),
        voice: { enabled: true, provider: "vapi", voice_es: "VOICE_ES", transfer_number: null, vapi_secret_hash: "abc123" },
      },
    } as never);
    const input = restoreInputFromSnapshot(snap) as { integrations: { voice?: Record<string, unknown> } };
    expect(input.integrations.voice).toEqual({ enabled: true, provider: "vapi", voice_es: "VOICE_ES" });
    expect(JSON.stringify(input)).not.toContain("abc123");
  });
});

describe("update route: versions", () => {
  it("a persona change writes a baseline (before) and a new version (after), approved by admin, with the note", async () => {
    state.sb = fakeSb({ client_agents: [agentRow()], agent_config_versions: [] });
    const res = await post({ systemPrompt: "New persona.", versionNote: "Tone fix" });
    expect(res.status).toBe(200);
    const rows = versionInserts(state.sb);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ note: "Baseline before the first tracked change", changed_fields: [] });
    expect((rows[0]!.snapshot as ConfigSnapshot).system_prompt).toBe("You are the front desk.\nBe brief.");
    expect(rows[1]).toMatchObject({
      approved_by: "admin",
      note: "Tone fix",
      changed_fields: ["system_prompt"],
      workspace_id: "ws_naile",
      agent_id: AGENT_ID,
    });
    expect((rows[1]!.snapshot as ConfigSnapshot).system_prompt).toBe("New persona.");
  });

  it("with history already there, only the new version is written", async () => {
    state.sb = fakeSb({ client_agents: [agentRow()], agent_config_versions: [{ agent_id: AGENT_ID, version: 4 }] });
    await post({ greetingMessage: "Hi there" });
    const rows = versionInserts(state.sb);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 5, changed_fields: ["greeting_message"] });
  });

  it("no versioned change (same persona, only notes / retainer) → no version", async () => {
    state.sb = fakeSb({ client_agents: [agentRow()], agent_config_versions: [] });
    const res = await post({ systemPrompt: "You are the front desk.\nBe brief.", notes: "x", monthlyRetainerCents: 5000 });
    expect(res.status).toBe(200);
    expect(versionInserts(state.sb)).toHaveLength(0);
  });

  it("secrets never reach the snapshot", async () => {
    state.sb = fakeSb({
      client_agents: [agentRow({ integrations: { booking: { link_url: "https://b.example.com" }, whatsapp: { auth_token: "SECRET123", from_number: "+1" } } })],
      agent_config_versions: [],
    });
    await post({ systemPrompt: "Changed" });
    expect(JSON.stringify(versionInserts(state.sb))).not.toContain("SECRET123");
  });

  it("table missing → the change still saves, no version, no error", async () => {
    state.sb = fakeSb(
      {
        client_agents: [agentRow()],
        agent_config_versions: () => ({ data: null, error: { code: "42P01", message: "missing" } }),
      },
      { insertError: { agent_config_versions: { code: "42P01" } } },
    );
    const res = await post({ systemPrompt: "Changed" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBeUndefined();
    expect(state.sb.updates).toHaveLength(1);
  });

  it("restore: applies the snapshot through the update path, audited, as a new version (history untouched)", async () => {
    const old = snapshotFromRow(agentRow({ system_prompt: "Old persona", greeting_message: "Old hello" }) as never);
    state.sb = fakeSb({
      client_agents: [agentRow()],
      agent_config_versions: [{ id: "v2", created_at: "2026-01-01", agent_id: AGENT_ID, workspace_id: "ws_naile", version: 2, snapshot: old, changed_fields: [], approved_by: "admin", note: null }],
    });
    const res = await post({ restoreVersion: 2 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.restoredFrom).toBe(2);
    expect(state.sb.updates).toHaveLength(1);
    expect(state.sb.updates[0]!.table).toBe("client_agents");
    expect(state.sb.updates[0]!.patch).toMatchObject({ system_prompt: "Old persona", greeting_message: "Old hello" });
    expect(state.sb.updates.some((u) => u.table === "agent_config_versions")).toBe(false);
    const rows = versionInserts(state.sb);
    expect(rows.at(-1)).toMatchObject({ note: "Restored from version 2", approved_by: "admin" });
    expect(audits[0]!.reason).toMatch(/^agent_config_restore:v2/);
    // Slug is never part of a restore.
    expect(state.sb.updates[0]!.patch).not.toHaveProperty("slug");
  });

  it("restore: unknown version → 404; table missing → 503", async () => {
    state.sb = fakeSb({ client_agents: [agentRow()], agent_config_versions: [] });
    expect((await post({ restoreVersion: 9 })).status).toBe(404);
    state.sb = fakeSb({
      client_agents: [agentRow()],
      agent_config_versions: () => ({ data: null, error: { code: "PGRST205", message: "no table" } }),
    });
    expect((await post({ restoreVersion: 1 })).status).toBe(503);
  });

  it("restore: readiness still applies. A snapshot without a persona cannot be restored onto a live agent", async () => {
    const empty = snapshotFromRow(agentRow({ system_prompt: null }) as never);
    state.sb = fakeSb({
      client_agents: [agentRow()],
      agent_config_versions: [{ id: "v1", created_at: "2026-01-01", agent_id: AGENT_ID, workspace_id: "ws_naile", version: 1, snapshot: empty, changed_fields: [], approved_by: "admin", note: null }],
    });
    const res = await post({ restoreVersion: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("restore_blocked");
    expect(state.sb.updates).toHaveLength(0);
  });

  it("restore: the same schema validation as a manual edit (bad link in a snapshot is refused)", async () => {
    const bad = snapshotFromRow(agentRow({ integrations: { booking: { link_url: "http://insecure.example.com" } } }) as never);
    state.sb = fakeSb({
      client_agents: [agentRow()],
      agent_config_versions: [{ id: "v1", created_at: "2026-01-01", agent_id: AGENT_ID, workspace_id: "ws_naile", version: 1, snapshot: bad, changed_fields: [], approved_by: "admin", note: null }],
    });
    const res = await post({ restoreVersion: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("restore_invalid");
    expect(state.sb.updates).toHaveLength(0);
  });

  it("restore needs the admin session", async () => {
    state.authed = false;
    expect((await post({ restoreVersion: 1 })).status).toBe(401);
  });
});

describe("GET versions", () => {
  it("lists versions plus the current snapshot; unavailable when the table is missing", async () => {
    const snap = snapshotFromRow(agentRow() as never);
    state.sb = fakeSb({
      client_agents: [agentRow()],
      agent_config_versions: [{ id: "v1", created_at: "2026-01-01", agent_id: AGENT_ID, workspace_id: "ws_naile", version: 1, snapshot: snap, changed_fields: [], approved_by: "admin", note: "n" }],
    });
    const call = () => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: AGENT_ID }) });
    const body = await (await call()).json();
    expect(body.available).toBe(true);
    expect(body.versions).toHaveLength(1);
    expect(body.current.system_prompt).toBe("You are the front desk.\nBe brief.");

    state.sb = fakeSb({
      client_agents: [agentRow()],
      agent_config_versions: () => ({ data: null, error: { code: "42P01", message: "x" } }),
    });
    const missing = await (await call()).json();
    expect(missing).toMatchObject({ ok: true, available: false, versions: [] });
  });

  it("401 without admin", async () => {
    state.authed = false;
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: AGENT_ID }) });
    expect(res.status).toBe(401);
  });
});
