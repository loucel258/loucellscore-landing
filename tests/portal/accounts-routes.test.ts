import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, uuid, type Row } from "./fake-db";

const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sb: null as unknown,
  audits: [] as Array<{ user_id: string; role: string; reason: string; decision?: string; workspace_id: string }>,
  approve: vi.fn(),
  reject: vi.fn(),
  emails: [] as unknown[],
  alerts: [] as unknown[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (h.jar.has(n) ? { value: h.jar.get(n)! } : undefined),
    set: (n: string, v: string) => void h.jar.set(n, v),
    delete: (n: string) => void h.jar.delete(n),
  }),
}));
vi.mock("@/lib/audit/client", () => ({ getServiceClient: () => h.sb }));
vi.mock("@/lib/rate-limit/limiter", () => ({ rateLimit: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock("@/lib/audit/writer", () => ({
  writeAuditEntry: async (e: { user_id: string; role: string; reason: string; workspace_id: string }) => {
    h.audits.push(e);
    return { ok: true };
  },
}));
vi.mock("@/lib/notify/resend", () => ({
  sendEmail: async (m: unknown) => {
    h.emails.push(m);
    return { ok: true };
  },
  sendInternalAlert: async (m: unknown) => {
    h.alerts.push(m);
  },
}));
vi.mock("@/lib/portal/encrypt", () => ({ encryptMessage: () => "cipher" }));
vi.mock("@/lib/portal/export-data", () => ({
  loadConversationExport: async () => [],
  loadBookingExport: async () => [],
}));
vi.mock("@/lib/portal/hitl", async (orig) => {
  const real = await orig<typeof import("@/lib/portal/hitl")>();
  return {
    ...real,
    // Route tests only check who may call and what identity is passed.
    approveAction: (...a: unknown[]) => h.approve(...a),
    rejectAction: (...a: unknown[]) => h.reject(...a),
  };
});

import { cookieName, hashPasscode, mintPortalSession, verifyPasscode } from "@/lib/portal/auth";
import { POST as approvePost } from "@/app/api/portal/[slug]/hitl/approve/route";
import { POST as rejectPost } from "@/app/api/portal/[slug]/hitl/reject/route";
import { GET as exportGet } from "@/app/api/portal/[slug]/export/route";
import { POST as teamPost } from "@/app/api/portal/[slug]/team/route";
import { POST as tagPost } from "@/app/api/portal/[slug]/conversation/[sessionId]/tag/route";
import { POST as sendPost, DELETE as releaseDelete } from "@/app/api/portal/[slug]/conversation/[sessionId]/send/route";
import { TeamActionSchema, addMember, deactivateMember, listTeam } from "@/lib/portal/team";
import { decidedByLabel, deciderUserIds, loadDeciderNames } from "@/lib/portal/deciders";

const SLUG = "acme";
const SALT = "ab".repeat(16);
const OWNER = uuid(10);
const STAFF = uuid(11);
const APPROVAL = uuid(50);

function person(id: number, email: string, name: string, role: string, extra: Row = {}): Row {
  return {
    id: uuid(id),
    portal_access_id: uuid(1),
    engagement_id: uuid(2),
    email,
    name,
    role,
    passcode_salt: SALT,
    passcode_hash: hashPasscode("CODE", SALT),
    active: true,
    revoked_at: null,
    last_login_at: null,
    login_count: 0,
    sessions_valid_after: null,
    created_at: "2026-09-02T00:00:00Z",
    ...extra,
  };
}

function world(extra: Record<string, Row[]> = {}) {
  return fakeDb({
    client_portal_access: [
      {
        id: uuid(1),
        client_slug: SLUG,
        engagement_id: uuid(2),
        display_name: "Acme",
        active: true,
        revoked_at: null,
        preferred_language: "en",
        created_at: "2026-09-01T00:00:00Z",
        shared_passcode_enabled: true,
      },
    ],
    portal_users: [person(10, "maria@acme.com", "Maria", "owner"), person(11, "sam@acme.com", "Sam", "staff")],
    engagements: [{ id: uuid(2), client_legal_name: "Acme LLC", client_email: null, vertical: "roofing", language: "en", created_at: null }],
    client_agents: [{ id: uuid(3), engagement_id: uuid(2), workspace_id: "ws1", name: "Front Desk", status: "live" }],
    conversation_messages: [{ session_id: "s1", engagement_id: uuid(2), workspace_id: "ws1" }],
    leads: [{ session_id: "s1", engagement_id: uuid(2), email: "visitor@x.com", created_at: "2026-09-30T00:00:00Z" }],
    conversation_tags: [],
    paused_sessions: [],
    ...extra,
  });
}

function as(userId: string | null) {
  h.jar.clear();
  h.jar.set(cookieName(SLUG), mintPortalSession(SLUG, userId)!);
}
const params = { params: Promise.resolve({ slug: SLUG }) };
const json = (body: unknown) =>
  new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  process.env.PORTAL_SESSION_SECRET = "test-secret";
  h.jar.clear();
  h.audits.length = 0;
  h.emails.length = 0;
  h.alerts.length = 0;
  h.approve.mockReset();
  h.reject.mockReset();
  h.approve.mockResolvedValue({ ok: true, executedRealtime: true });
  h.reject.mockResolvedValue({ ok: true });
  h.sb = world().sb;
});

describe("role enforcement on the server", () => {
  it("staff cannot approve or reject; the action is never run", async () => {
    as(STAFF);
    const a = await approvePost(json({ approvalId: APPROVAL }), params);
    expect(a.status).toBe(403);
    expect(await a.json()).toMatchObject({ ok: false, error: "forbidden" });
    const r = await rejectPost(json({ approvalId: APPROVAL }), params);
    expect(r.status).toBe(403);
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.reject).not.toHaveBeenCalled();
  });

  it("an owner approves and rejects, with the person passed as the actor", async () => {
    as(OWNER);
    expect((await approvePost(json({ approvalId: APPROVAL }), params)).status).toBe(200);
    expect(h.approve.mock.calls[0]![0]).toMatchObject({
      decider: "portal:acme",
      clientSlug: SLUG,
      actor: { userId: OWNER, name: "Maria", role: "owner" },
    });
    expect((await rejectPost(json({ approvalId: APPROVAL, reason: "no" }), params)).status).toBe(200);
    expect(h.reject.mock.calls[0]![0]).toMatchObject({ actor: { userId: OWNER, role: "owner" } });
  });

  it("shared access (v1 token) approves as owner with no person id", async () => {
    as(null);
    expect((await approvePost(json({ approvalId: APPROVAL }), params)).status).toBe(200);
    expect(h.approve.mock.calls[0]![0].actor).toMatchObject({ userId: null, role: "owner", label: "Shared access" });
  });

  it("no session is 401 before anything else", async () => {
    expect((await approvePost(json({ approvalId: APPROVAL }), params)).status).toBe(401);
    expect((await teamPost(json({ action: "add" }), params)).status).toBe(401);
  });

  it("staff cannot export CSV; owners can, and it is audited under the person", async () => {
    as(STAFF);
    const url = "http://x/api/portal/acme/export?type=conversations&days=30";
    expect((await exportGet(new Request(url), params)).status).toBe(403);
    expect(h.audits).toHaveLength(0);

    as(OWNER);
    const ok = await exportGet(new Request(url), params);
    expect(ok.status).toBe(200);
    expect(h.audits[0]).toMatchObject({ user_id: `portal:acme:${OWNER}`, role: "owner" });
    expect(h.audits[0]!.reason).toContain("portal_export:conversations");
  });

  it("staff cannot manage the team", async () => {
    as(STAFF);
    const res = await teamPost(json({ action: "add", name: "Zed", email: "zed@acme.com", role: "staff" }), params);
    expect(res.status).toBe(403);
    expect((world().tables.portal_users ?? []).length).toBe(2);
  });
});

describe("who did it: tag, take-over, release", () => {
  it("staff can tag; applied_by names the person", async () => {
    const db = world();
    h.sb = db.sb;
    as(STAFF);
    const res = await tagPost(json({ tag: "vip" }), { params: Promise.resolve({ slug: SLUG, sessionId: "s1" }) });
    expect(res.status).toBe(200);
    expect(db.tables.conversation_tags![0]).toMatchObject({ applied_by: `portal:acme:${STAFF}`, tag: "vip" });
  });

  it("shared access keeps the plain portal:<slug> identity", async () => {
    const db = world();
    h.sb = db.sb;
    as(null);
    await tagPost(json({ tag: "vip" }), { params: Promise.resolve({ slug: SLUG, sessionId: "s1" }) });
    expect(db.tables.conversation_tags![0]).toMatchObject({ applied_by: "portal:acme" });
  });

  it("staff can take over: reply emailed, pause and audit row name the person with role staff", async () => {
    const db = world({ paused_sessions: [] });
    h.sb = db.sb;
    as(STAFF);
    const res = await sendPost(json({ text: "On my way" }), { params: Promise.resolve({ slug: SLUG, sessionId: "s1" }) });
    expect(res.status).toBe(200);
    expect(h.emails).toHaveLength(1);
    expect(db.tables.paused_sessions![0]).toMatchObject({ session_id: "s1", paused_by: `portal:acme:${STAFF}` });
    expect(h.audits.at(-1)).toMatchObject({ user_id: `portal:acme:${STAFF}`, role: "staff" });
    expect(h.audits.at(-1)!.reason).toContain("take_over_message:emailed");
  });

  it("staff can release a take-over", async () => {
    as(STAFF);
    const res = await releaseDelete(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ slug: SLUG, sessionId: "s1" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("team management route (owner)", () => {
  it("adds a person: passcode returned once, only a hash stored, audit has field names only", async () => {
    const db = world();
    h.sb = db.sb;
    as(OWNER);
    const res = await teamPost(json({ action: "add", name: "  Lupe  ", email: " Lupe@Acme.COM ", role: "staff" }), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; passcode: string; member: { id: string; email: string; role: string } };
    expect(body.passcode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(body.member).toMatchObject({ email: "lupe@acme.com", role: "staff" });
    const row = db.tables.portal_users!.find((r) => r.email === "lupe@acme.com")!;
    expect(row.name).toBe("Lupe");
    expect(row.passcode_hash).not.toContain(body.passcode);
    expect(verifyPasscode(body.passcode, String(row.passcode_hash), String(row.passcode_salt))).toBe(true);
    // The response never carries the hash or salt.
    expect(JSON.stringify(body)).not.toContain(String(row.passcode_hash));

    const audit = h.audits.at(-1)!;
    expect(audit).toMatchObject({ user_id: `portal:acme:${OWNER}`, role: "owner" });
    expect(audit.reason).toBe(`portal_team_added:${row.id} role=staff fields=name,email,role`);
    expect(JSON.stringify(h.audits)).not.toContain(body.passcode);
    expect(JSON.stringify(h.audits)).not.toContain("lupe@acme.com");
  });

  it("validates input", async () => {
    as(OWNER);
    for (const bad of [
      { action: "add", name: "", email: "a@b.com", role: "staff" },
      { action: "add", name: "Zed", email: "not-an-email", role: "staff" },
      { action: "add", name: "Zed", email: "zed@acme.com", role: "admin" },
      { action: "reset", userId: "nope" },
      { action: "explode" },
    ]) {
      expect((await teamPost(json(bad), params)).status).toBe(400);
    }
  });

  it("rejects a duplicate email with 409", async () => {
    as(OWNER);
    const res = await teamPost(json({ action: "add", name: "Maria Two", email: "MARIA@acme.com", role: "staff" }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "already_exists" });
  });

  it("reset gives a new passcode and ends that person's sessions", async () => {
    const db = world();
    h.sb = db.sb;
    as(OWNER);
    const before = String(db.tables.portal_users![1]!.passcode_hash);
    const res = await teamPost(json({ action: "reset", userId: STAFF }), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { passcode: string };
    const row = db.tables.portal_users![1]!;
    expect(row.passcode_hash).not.toBe(before);
    expect(verifyPasscode(body.passcode, String(row.passcode_hash), String(row.passcode_salt))).toBe(true);
    expect(row.sessions_valid_after).toBeTruthy();
    expect(h.audits.at(-1)!.reason).toBe(`portal_team_passcode_reset:${STAFF} fields=passcode sessions_ended`);
    expect(JSON.stringify(h.audits)).not.toContain(body.passcode);
  });

  it("deactivates a person and ends their sessions; cannot deactivate yourself", async () => {
    const db = world();
    h.sb = db.sb;
    as(OWNER);
    expect((await teamPost(json({ action: "deactivate", userId: OWNER }), params)).status).toBe(409);
    const res = await teamPost(json({ action: "deactivate", userId: STAFF }), params);
    expect(res.status).toBe(200);
    expect(db.tables.portal_users![1]).toMatchObject({ active: false });
    expect(db.tables.portal_users![1]!.revoked_at).toBeTruthy();
    expect(db.tables.portal_users![1]!.sessions_valid_after).toBeTruthy();
    // Their open session is dead on the next request.
    as(STAFF);
    expect((await approvePost(json({ approvalId: APPROVAL }), params)).status).toBe(401);
  });

  it("the team tab degrades when migration 069 is missing", async () => {
    h.sb = world().sb;
    const missing = fakeDb({ client_portal_access: [{ id: uuid(1), client_slug: SLUG }] }, { missingTables: ["portal_users"] });
    expect(await listTeam(missing.sb, uuid(1))).toBeNull();
    const res = await addMember(missing.sb, { accessId: uuid(1), engagementId: uuid(2), name: "Z", email: "z@a.com", role: "staff" });
    expect(res).toMatchObject({ ok: false, error: "team_unavailable", status: 503 });
  });
});

describe("team rules", () => {
  it("normalizes email and trims the name", () => {
    const ok = TeamActionSchema.parse({ action: "add", name: "  Ana ", email: "  ANA@Acme.com ", role: "owner" });
    expect(ok).toMatchObject({ name: "Ana", email: "ana@acme.com", role: "owner" });
    expect(TeamActionSchema.safeParse({ action: "add", name: "x".repeat(81), email: "a@b.com", role: "staff" }).success).toBe(false);
  });

  it("re-adding a deactivated email reactivates them with a new passcode and role", async () => {
    const db = world();
    const sb = db.sb;
    await deactivateMember(sb, { accessId: uuid(1), userId: STAFF, sharedEnabled: true });
    const res = await addMember(sb, { accessId: uuid(1), engagementId: uuid(2), name: "Sam R", email: "sam@acme.com", role: "owner" });
    expect(res).toMatchObject({ ok: true, reactivated: true });
    expect(db.tables.portal_users![1]).toMatchObject({ active: true, role: "owner", name: "Sam R", revoked_at: null });
    expect(db.tables.portal_users).toHaveLength(2);
  });

  it("the last active owner cannot be deactivated once the shared passcode is off", async () => {
    const db = world();
    const lone = await deactivateMember(db.sb, { accessId: uuid(1), userId: OWNER, sharedEnabled: false });
    expect(lone).toMatchObject({ ok: false, error: "last_owner" });
    // Fine while the shared passcode still gives a way in.
    expect(await deactivateMember(db.sb, { accessId: uuid(1), userId: OWNER, sharedEnabled: true })).toMatchObject({ ok: true });
  });
});

describe("decider attribution (approveAction / rejectAction)", () => {
  async function run(kind: "approve" | "reject", actor: ReturnType<typeof makeActor> | undefined) {
    const mod = await vi.importActual<typeof import("@/lib/portal/hitl")>("@/lib/portal/hitl");
    const db = fakeDb({
      pending_approvals: [
        { id: APPROVAL, workspace_id: "ws1", action_type: "send_refund", recipient: null, proposed_text: "Refund $20", edited_text: null, status: "pending", risk_score: 10 },
      ],
    });
    h.sb = db.sb;
    const base = { approvalId: APPROVAL, workspaceIds: ["ws1"], decider: "portal:acme", clientSlug: SLUG, actor };
    const res = kind === "approve" ? await mod.approveAction(base) : await mod.rejectAction(base);
    return { res, row: db.tables.pending_approvals![0]!, audit: h.audits.at(-1)! };
  }
  const makeActor = (userId: string | null, role: "owner" | "staff", name: string) => ({
    userId,
    name,
    role,
    label: name,
  });

  it("a person's approval records their id as decider and names them in the audit row", async () => {
    const { res, row, audit } = await run("approve", makeActor(OWNER, "owner", "Maria"));
    expect(res.ok).toBe(true);
    expect(row).toMatchObject({ status: "approved", decider_id: OWNER });
    expect(audit).toMatchObject({ user_id: `portal:acme:${OWNER}`, role: "owner", workspace_id: "ws1" });
    expect(audit.reason).toContain("hitl_approved:send_refund");
    expect(JSON.stringify(h.alerts)).toContain("Maria (owner)");
  });

  it("a person's rejection is attributed too", async () => {
    const { res, row, audit } = await run("reject", makeActor(OWNER, "owner", "Maria"));
    expect(res.ok).toBe(true);
    expect(row).toMatchObject({ status: "rejected", decider_id: OWNER });
    expect(audit).toMatchObject({ user_id: `portal:acme:${OWNER}`, role: "owner", decision: "DENY" });
  });

  it("shared access keeps portal:<slug> as decider and audit actor (role owner)", async () => {
    const { row, audit } = await run("approve", makeActor(null, "owner", "Shared access"));
    expect(row.decider_id).toBe("portal:acme");
    expect(audit).toMatchObject({ user_id: "portal:acme", role: "owner" });
  });

  it("without an actor the old identity is unchanged", async () => {
    const { row, audit } = await run("approve", undefined);
    expect(row.decider_id).toBe("portal:acme");
    expect(audit).toMatchObject({ user_id: "portal:acme", role: "client_portal" });
  });
});

describe("approval history shows who decided", () => {
  it("looks up names for person ids only and labels the decision", async () => {
    const db = world();
    expect(deciderUserIds([OWNER, "portal:acme", null, undefined, OWNER, "admin:steven"])).toEqual([OWNER]);
    const names = await loadDeciderNames(db.sb, uuid(2), [OWNER, "portal:acme", STAFF]);
    expect(names.get(OWNER)).toBe("Maria");
    expect(decidedByLabel("en", "approved", OWNER, names)).toBe("Approved by Maria");
    expect(decidedByLabel("en", "rejected", OWNER, names)).toBe("Rejected by Maria");
    expect(decidedByLabel("es", "approved", OWNER, names)).toBe("Aprobado por Maria");
    expect(decidedByLabel("en", "approved", "portal:acme", names)).toBeNull();
    expect(decidedByLabel("en", "approved", null, names)).toBeNull();
  });

  it("is scoped to the engagement and empty when the table is missing", async () => {
    const db = world();
    expect((await loadDeciderNames(db.sb, uuid(999), [OWNER])).size).toBe(0);
    const missing = fakeDb({}, { missingTables: ["portal_users"] });
    expect((await loadDeciderNames(missing.sb, uuid(2), [OWNER])).size).toBe(0);
  });
});
