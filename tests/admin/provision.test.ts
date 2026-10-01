import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Fast, deterministic passcode hashing and a spy for audit rows.
vi.mock("@/lib/portal/auth", () => ({
  hashPasscode: (p: string, s: string) => `hash(${p},${s})`,
  generatePasscodeSalt: () => "salt",
}));
const audits: string[] = [];
vi.mock("@/lib/admin/audit", () => ({
  engagementAuditWorkspace: async () => "ws_test",
  writeAdminAudit: async (a: { reason: string }) => {
    audits.push(a.reason);
  },
}));

import { provisionNewClient } from "@/lib/admin/provision";
import type { NewClientInput } from "@/lib/admin/client-intake";

type Row = Record<string, unknown>;
type Err = { code: string; message: string };

/**
 * In-memory stand-in for the PostgREST calls provision.ts makes: eq, like,
 * ilike, in, order, limit, maybeSingle/single, insert(...).select().single().
 * Enforces the unique indexes that make the flow idempotent.
 */
function fakeDb(opts: { failInsert?: Record<string, Err | undefined> } = {}) {
  const tables: Record<string, Row[]> = {
    crm_accounts: [],
    engagements: [],
    client_agents: [],
    client_portal_access: [],
  };
  const unique: Record<string, (r: Row) => string> = {
    crm_accounts: (r) => String(r.primary_contact_email ?? "").toLowerCase(),
    engagements: (r) => String(r.engagement_ref),
    client_agents: (r) => String(r.slug),
    client_portal_access: (r) => String(r.client_slug),
  };
  let seq = 0;
  const failInsert = { ...(opts.failInsert ?? {}) };

  const likeToRe = (p: string, flags = "") =>
    new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, flags);

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let limit = Infinity;
    let pending: Row | null = null;
    const exec = (): { data: Row[] | null; error: Err | null } => {
      if (pending) {
        const err = failInsert[table];
        if (err) {
          failInsert[table] = undefined; // fail once
          return { data: null, error: err };
        }
        const key = unique[table]!(pending);
        if (tables[table]!.some((r) => unique[table]!(r) === key)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const row = { id: `${table}-${++seq}`, created_at: new Date(2026, 9, 1, 0, 0, seq).toISOString(), ...pending };
        tables[table]!.push(row);
        return { data: [row], error: null };
      }
      return { data: tables[table]!.filter((r) => filters.every((f) => f(r))).slice(0, limit), error: null };
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      like: (c: string, p: string) => (filters.push((r) => likeToRe(p).test(String(r[c]))), q),
      ilike: (c: string, p: string) => (filters.push((r) => likeToRe(p, "i").test(String(r[c]))), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      insert: (row: Row) => ((pending = row), q),
      maybeSingle: async () => {
        const { data, error } = exec();
        return { data: data?.[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = exec();
        return { data: data?.[0] ?? null, error };
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(resolve, reject),
    };
    return q;
  }
  return { sb: { from } as unknown as SupabaseClient, tables, failInsert };
}

const input: NewClientInput = {
  idempotencyKey: "3f9a1c2b-5d6e-4f70-8a1b-2c3d4e5f6a7b",
  businessName: "Sunset Roofing LLC",
  ownerName: "Maria Lopez",
  ownerEmail: "Owner@Sunset.com",
  ownerPhone: "+1 561 555 0100",
  language: "es",
  vertical: "roofing",
  agentType: "ai_front_desk",
  website: "sunsetroofing.com",
};

beforeEach(() => {
  audits.length = 0;
});

describe("provisionNewClient", () => {
  it("creates account, engagement, agent and portal in order", async () => {
    const { sb, tables } = fakeDb();
    const res = await provisionNewClient(sb, input);

    expect(res.ok).toBe(true);
    expect(res.steps.map((s) => `${s.step}:${s.status}`)).toEqual([
      "account:created",
      "engagement:created",
      "agent:created",
      "portal:created",
    ]);
    expect(tables.crm_accounts[0]).toMatchObject({
      account_name: "Sunset Roofing LLC",
      primary_contact_name: "Maria Lopez",
      primary_contact_email: "owner@sunset.com",
      primary_contact_phone: "+1 561 555 0100",
      lifecycle: "prospect",
    });
    expect(tables.engagements[0]).toMatchObject({
      engagement_type: "smv_build",
      status: "in_progress",
      audit_fee_cents: 0,
      account_id: res.accountId,
    });
    expect(String(tables.engagements[0]!.engagement_ref)).toMatch(/^BLD-\d{8}-SRL-3F9A1C2B$/);
    expect(tables.client_agents[0]).toMatchObject({
      slug: "sunset-roofing",
      status: "designing",
      allowed_origins: ["https://sunsetroofing.com", "https://www.sunsetroofing.com"],
    });
    expect(tables.client_portal_access[0]).toMatchObject({ client_slug: "sunset-roofing" });
    expect(res.passcode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(tables.client_portal_access[0]!.passcode_hash).toBe(`hash(${res.passcode},salt)`);
    expect(res.clientHref).toBe(`/admin/clients/${res.accountId}?tab=setup`);
    expect(audits).toEqual(["client_provisioned:sunset-roofing", "portal_access_created:sunset-roofing"]);
  });

  it("resubmitting the same form resumes instead of duplicating", async () => {
    const { sb, tables } = fakeDb();
    const first = await provisionNewClient(sb, input);
    const again = await provisionNewClient(sb, input);

    expect(again.ok).toBe(true);
    expect(again.steps.map((s) => s.status)).toEqual(["reused", "reused", "reused", "reused"]);
    expect(again.engagementId).toBe(first.engagementId);
    expect(again.agentId).toBe(first.agentId);
    expect(again.passcode).toBeUndefined(); // shown once
    expect(tables.engagements).toHaveLength(1);
    expect(tables.client_agents).toHaveLength(1);
    expect(tables.client_portal_access).toHaveLength(1);
  });

  it("reports the failed step and what was created, then resumes on retry", async () => {
    const { sb, tables } = fakeDb({
      failInsert: { client_portal_access: { code: "XX000", message: "connection reset" } },
    });
    const failed = await provisionNewClient(sb, input);
    expect(failed.ok).toBe(false);
    expect(failed.failedStep).toBe("portal");
    expect(failed.steps.map((s) => `${s.step}:${s.status}`)).toEqual([
      "account:created",
      "engagement:created",
      "agent:created",
      "portal:failed",
    ]);
    expect(failed.accountId).toBeDefined();
    expect(failed.agentId).toBeDefined();

    const retry = await provisionNewClient(sb, input);
    expect(retry.ok).toBe(true);
    expect(retry.steps.map((s) => `${s.step}:${s.status}`)).toEqual([
      "account:reused",
      "engagement:reused",
      "agent:reused",
      "portal:created",
    ]);
    expect(retry.passcode).toBeDefined();
    expect(tables.client_agents).toHaveLength(1);
  });

  it("marks later steps skipped when an early step fails", async () => {
    const { sb } = fakeDb({ failInsert: { engagements: { code: "XX000", message: "boom" } } });
    const res = await provisionNewClient(sb, input);
    expect(res.failedStep).toBe("engagement");
    expect(res.steps.map((s) => `${s.step}:${s.status}`)).toEqual([
      "account:created",
      "engagement:failed",
      "agent:skipped",
      "portal:skipped",
    ]);
  });

  it("picks the next free address when the slug is taken", async () => {
    const { sb, tables } = fakeDb();
    tables.client_agents.push({ id: "other", slug: "sunset-roofing", workspace_id: "ws_other", engagement_id: "e-other" });
    tables.client_portal_access.push({ id: "p-other", client_slug: "sunset-roofing-2", engagement_id: "e-x" });
    const res = await provisionNewClient(sb, input);
    expect(res.ok).toBe(true);
    // -2 is free for agents but taken as a portal address, so -3 is used for both.
    expect(res.agentSlug).toBe("sunset-roofing-3");
    expect(res.portalSlug).toBe("sunset-roofing-3");
  });

  it("refuses to attach this form's engagement to a different owner", async () => {
    const { sb } = fakeDb();
    await provisionNewClient(sb, input);
    const res = await provisionNewClient(sb, { ...input, ownerEmail: "someone@else.com" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("idempotency_conflict");
    expect(res.failedStep).toBe("engagement");
  });
});
