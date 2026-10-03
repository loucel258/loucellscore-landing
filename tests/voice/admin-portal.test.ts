import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fakeSb, type FakeSb } from "../reports/fake-sb";

const state: { authed: boolean; sb: FakeSb | null } = { authed: true, sb: null };
vi.mock("@/lib/admin/auth", () => ({ isAdminAuthed: async () => state.authed }));
vi.mock("@/lib/audit/client", () => ({ getServiceClient: () => state.sb }));
vi.mock("@/lib/agents/resolver", () => ({ canonicalizeOrigin: (o: string) => o, invalidateAgentCache: () => {} }));
vi.mock("@/lib/audit/writer", () => ({ writeAuditEntry: async () => ({ ok: true }) }));

import { POST } from "@/app/api/admin/agents/[id]/update/route";
import { sha256Hex } from "@/lib/crypto/hash";
import { checkReadiness } from "@/lib/agent-runtime/readiness";
import { parseIntegrations, toAgentConfig } from "@/lib/agent-runtime/config";
import { agentFixture } from "../runtime/helpers";
import { applyCallMeta, buildThreads, formatCallLength, isCallSession, threadDisplayName, withOutcomes } from "@/lib/portal/threads";
import { portalStringKeys, t } from "@/lib/portal/strings";
import { isCustomerSession } from "@/lib/admin/audit-actors";

const AGENT_ID = "33333333-3333-4333-8333-333333333333";
const row = (integrations: Record<string, unknown> | null = null) => ({
  id: AGENT_ID,
  slug: "salon",
  workspace_id: "ws_salon",
  engagement_id: "eng-1",
  name: "Salon",
  agent_type: "ai_front_desk",
  channels: ["chat_widget"],
  tools_enabled: [],
  status: "designing",
  system_prompt: "Front desk.",
  allowed_origins: ["https://salon.example.com"],
  shadow_mode_started_at: null,
  uat_started_at: null,
  live_started_at: null,
  archived_at: null,
  integrations,
  monthly_retainer_cents: 0,
  retainer_active: false,
  minutes_saved_per_conversation: 5,
});
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: AGENT_ID }) },
  );
const written = (sb: FakeSb) => (sb.updates[0]!.patch as { integrations: Record<string, Record<string, unknown>> }).integrations;

beforeEach(() => {
  state.authed = true;
  state.sb = null;
});

describe("admin update: integrations.voice", () => {
  it("rejects a bad transfer number, provider and minutes", async () => {
    state.sb = fakeSb({ client_agents: [row()] });
    for (const voice of [{ transfer_number: "561-555-1234" }, { provider: "retell" }, { max_call_minutes: 0 }, { max_call_minutes: 600 }, { default_lang: "fr" }]) {
      const res = await post({ integrations: { voice } });
      expect(res.status, JSON.stringify(voice)).toBe(400);
    }
    expect(state.sb.updates).toHaveLength(0);
  });

  it("saves a valid config, merging with what is there", async () => {
    state.sb = fakeSb({ client_agents: [row({ kb: "FAQ", voice: { voice_en: "keep" } })] });
    const res = await post({
      integrations: { voice: { provider: "twilio_cr", voice_es: "ES1", default_lang: "es", transfer_number: "+15615551234", recording_notice: true, max_call_minutes: 8 } },
    });
    expect(res.status).toBe(200);
    const v = written(state.sb).voice!;
    expect(v).toMatchObject({ provider: "twilio_cr", voice_es: "ES1", voice_en: "keep", transfer_number: "+15615551234", max_call_minutes: 8 });
    expect(written(state.sb).kb).toBe("FAQ");
  });

  it("an empty transfer number clears it", async () => {
    state.sb = fakeSb({ client_agents: [row({ voice: { transfer_number: "+15615551234" } })] });
    await post({ integrations: { voice: { transfer_number: "" } } });
    expect(written(state.sb).voice!.transfer_number).toBeUndefined();
  });

  it("enabling twilio_cr voice needs the Twilio keys in the vault", async () => {
    state.sb = fakeSb({ client_agents: [row()], vault_credentials: [] });
    const res = await post({ integrations: { voice: { enabled: true, provider: "twilio_cr" } } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("twilio_not_configured");

    state.sb = fakeSb({ client_agents: [row()], vault_credentials: [{ id: "v1", workspace_id: "ws_salon", provider: "twilio" }] });
    const ok = await post({ integrations: { voice: { enabled: true, provider: "twilio_cr" } } });
    expect(await ok.json()).toMatchObject({ ok: true });
  });

  it("vapi: enabling needs the secret; rotating returns it once and stores only its hash", async () => {
    state.sb = fakeSb({ client_agents: [row()] });
    const refused = await post({ integrations: { voice: { enabled: true, provider: "vapi" } } });
    expect(refused.status).toBe(422);

    state.sb = fakeSb({ client_agents: [row()] });
    const res = await post({ integrations: { voice: { enabled: true, provider: "vapi", vapi_secret_rotate: true } } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vapiSecret).toMatch(/^vk_/);
    const stored = written(state.sb).voice!;
    expect(stored.vapi_secret_hash).toBe(sha256Hex(body.vapiSecret));
    expect(JSON.stringify(state.sb.updates)).not.toContain(body.vapiSecret);
  });

  it("requires an admin session", async () => {
    state.authed = false;
    expect((await post({ integrations: { voice: { enabled: false } } })).status).toBe(401);
  });
});

describe("config + readiness for channel voice", () => {
  const cfg = (integrations: Record<string, unknown>) => toAgentConfig(agentFixture({ integrations }))!;

  it("parses voice defaults and drops invalid values", () => {
    const v = parseIntegrations({ voice: { enabled: true, transfer_number: "nope", provider: "x", max_call_minutes: 999 } }).voice;
    expect(v).toMatchObject({ enabled: true, provider: "twilio_cr", transfer_number: null, recording_notice: true, max_call_minutes: 10 });
    expect(parseIntegrations({}).voice.enabled).toBe(false);
  });

  it("twilio_cr needs Twilio credentials and the gateway env; the transfer number is optional", () => {
    const c = cfg({ voice: { enabled: true }, booking: { business_hours: { mon: [9, 18] }, timezone: "America/New_York" } });
    const none = checkReadiness(c, { channels: ["voice"] });
    expect(none.missing.map((m) => m.key)).toEqual(["twilio_credential", "voice_gateway_url", "voice_gateway_secret"]);
    const ok = checkReadiness(c, { channels: ["voice"], twilioCredential: true, voiceGatewayUrl: true, voiceGatewaySecret: true });
    expect(ok.ready).toBe(true);
  });

  it("vapi needs the custom LLM secret", () => {
    const c = cfg({ voice: { enabled: true, provider: "vapi" }, booking: { business_hours: { mon: [9, 18] } } });
    expect(checkReadiness(c, { channels: ["voice"] }).missing.map((m) => m.key)).toContain("voice_vapi_secret");
    const withHash = cfg({ voice: { enabled: true, provider: "vapi", vapi_secret_hash: "a".repeat(64) }, booking: { business_hours: { mon: [9, 18] } } });
    expect(checkReadiness(withHash, { channels: ["voice"] }).missing.map((m) => m.key)).not.toContain("voice_vapi_secret");
  });
});

describe("portal: calls in the inbox", () => {
  const msg = (session: string, role: "user" | "assistant", at: string) => ({
    id: `${session}-${at}`,
    session_id: session,
    role,
    inserted_at: at,
    tool_summary: null,
    cipher_b64: "x",
  });

  it("call sessions become threads with channel call, apart from web sessions", () => {
    const threads = buildThreads({
      webMessages: [msg("call_CA1", "user", "2026-10-02T10:00:00Z"), msg("call_CA1", "assistant", "2026-10-02T10:00:01Z"), msg("s_web_1", "user", "2026-10-02T09:00:00Z")],
      smsMessages: [],
    });
    expect(threads.map((t) => [t.id, t.channel])).toEqual([["call_CA1", "call"], ["s_web_1", "web"]]);
    expect(isCallSession("call_CA1")).toBe(true);
  });

  it("attaches caller, duration and outcome from voice_calls", () => {
    const threads = buildThreads({ webMessages: [msg("call_CA1", "user", "2026-10-02T10:00:00Z")], smsMessages: [] });
    const [th] = applyCallMeta(threads, [{ call_sid: "CA1", caller: "+13055551234", duration_sec: 125, outcome: "booked" }]);
    expect(th!.call).toEqual({ durationSec: 125, outcome: "booked", summary: null });
    expect(threadDisplayName(th!, "Visitor")).toBe("(305) 555-1234");
    expect(formatCallLength(125)).toBe("2 min 05 s");
    expect(formatCallLength(45)).toBe("45 s");
    expect(withOutcomes([th!], new Map())[0]!.outcome).toBe("booked");
  });

  it("without voice_calls the call still shows, from its transcript", () => {
    const threads = buildThreads({ webMessages: [msg("call_CA9", "user", "2026-10-02T10:00:00Z")], smsMessages: [] });
    expect(applyCallMeta(threads, [])[0]!.call).toBeUndefined();
  });

  it("calls count as conversations in the audit-based stats (customer session)", () => {
    expect(isCustomerSession("call_CA1")).toBe(true);
  });

  it("has English and Spanish strings for the call badge and outcomes", () => {
    for (const k of ["badge.call", "call.length", "call.outcome.answered", "call.outcome.booked", "call.outcome.escalated", "call.outcome.transferred", "call.outcome.abandoned"]) {
      expect(portalStringKeys("en")).toContain(k);
      expect(portalStringKeys("es")).toContain(k);
    }
    expect(t("es", "badge.call")).toBe("Llamada");
    for (const lang of ["en", "es"] as const) {
      for (const k of portalStringKeys(lang).filter((x) => x.startsWith("call.") || x === "badge.call")) {
        expect(t(lang, k, { duration: "1 s" })).not.toContain("—");
      }
    }
  });
});

describe("migration 071", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/071_voice_calls.sql"), "utf8");
  it("creates voice_calls with RLS, locked grants and the dashboard read role", () => {
    expect(sql).toContain("create table if not exists public.voice_calls");
    expect(sql).toContain("call_sid      text not null unique");
    expect(sql).toContain("check (outcome in ('answered', 'booked', 'escalated', 'transferred', 'abandoned'))");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.voice_calls from anon, authenticated");
    expect(sql).toContain("grant select, insert, update on public.voice_calls to service_role");
    expect(sql).toContain("grant select on public.voice_calls to loucels_dashboard_read");
    expect(sql).toContain("create policy dashboard_read_select on public.voice_calls");
    expect(sql).not.toMatch(/loucells_dashboard_read/);
    expect(sql).toContain("'voice'");
  });
});
