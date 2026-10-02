import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, uuid, type Row } from "./fake-db";
import { hashPasscode } from "@/lib/portal/auth";

const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sb: null as unknown,
  adminOk: true,
  audits: [] as string[],
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
vi.mock("@/lib/admin/auth", () => ({ isAdminAuthed: async () => h.adminOk }));
vi.mock("@/lib/admin/audit", () => ({
  engagementAuditWorkspace: async () => "ws1",
  writeAdminAudit: async (a: { reason: string }) => {
    h.audits.push(a.reason);
  },
}));

import { POST as adminUsers } from "@/app/api/admin/portal-access/users/route";
import { POST as login } from "@/app/api/portal/[slug]/login/route";
import { cookieName, getPortalSession } from "@/lib/portal/auth";
import {
  summarizeVerifications,
  verificationLine,
  verificationState,
} from "@/lib/portal/verification-badge";
import { verificationFlags, verificationRows } from "@/lib/admin/audit-verification";
import { buildNeedsYou, type ClientRef } from "@/lib/admin/needs-you";
import { t } from "@/lib/portal/strings";
import type { LatestVerification } from "@/lib/audit/verification";

const SALT = "ab".repeat(16);
const ENG = uuid(2);

function world(extra: { access?: Row; users?: Row[] } = {}) {
  return fakeDb({
    client_portal_access: [
      {
        id: uuid(1),
        client_slug: "acme",
        engagement_id: ENG,
        active: true,
        revoked_at: null,
        display_name: "Acme",
        created_at: "2026-09-01T00:00:00Z",
        shared_passcode_enabled: true,
        passcode_salt: SALT,
        passcode_hash: hashPasscode("SHARED-CODE", SALT),
        ...extra.access,
      },
    ],
    portal_users: extra.users ?? [],
    client_agents: [{ engagement_id: ENG, workspace_id: "ws1" }],
  });
}

const call = (body: unknown) =>
  adminUsers(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  process.env.PORTAL_SESSION_SECRET = "test-secret";
  h.jar.clear();
  h.adminOk = true;
  h.audits.length = 0;
  h.sb = world().sb;
});

describe("admin portal team route", () => {
  it("requires an admin session", async () => {
    h.adminOk = false;
    expect((await call({ engagementId: ENG, action: "add", name: "M", email: "m@a.com", role: "owner" })).status).toBe(401);
  });

  it("creates the first owner; passcode once, audit names fields only", async () => {
    const db = world();
    h.sb = db.sb;
    const res = await call({ engagementId: ENG, action: "add", name: "Maria", email: "Maria@Acme.com", role: "owner" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { passcode: string; member: { role: string } };
    expect(body.passcode).toBeTruthy();
    expect(body.member.role).toBe("owner");
    expect(db.tables.portal_users![0]).toMatchObject({ email: "maria@acme.com", engagement_id: ENG });
    expect(h.audits[0]).toMatch(/^portal_user_added:acme:.+ role=owner fields=name,email,role$/);
    expect(JSON.stringify(h.audits)).not.toContain(body.passcode);
  });

  it("will not turn the shared passcode off before an owner exists, then does, and sign-in follows", async () => {
    const db = world();
    h.sb = db.sb;
    const off = await call({ engagementId: ENG, action: "shared", enabled: false });
    expect(off.status).toBe(409);
    expect(await off.json()).toMatchObject({ error: "needs_owner" });

    const add = await call({ engagementId: ENG, action: "add", name: "Maria", email: "maria@acme.com", role: "owner" });
    const { passcode } = (await add.json()) as { passcode: string };
    expect((await call({ engagementId: ENG, action: "shared", enabled: false })).status).toBe(200);
    expect(db.tables.client_portal_access![0]).toMatchObject({ shared_passcode_enabled: false });
    expect(h.audits.at(-1)).toBe("portal_shared_passcode_off:acme fields=shared_passcode_enabled");

    const signIn = (b: Record<string, unknown>) =>
      login(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }), {
        params: Promise.resolve({ slug: "acme" }),
      });
    expect((await signIn({ passcode: "SHARED-CODE" })).status).toBe(401);
    expect((await signIn({ email: "maria@acme.com", passcode })).status).toBe(200);
    expect((await getPortalSession("acme"))?.actor).toMatchObject({ name: "Maria", role: "owner" });
    expect(h.jar.get(cookieName("acme"))).toBeTruthy();
  });

  it("guards the last owner when the shared passcode is off, and validates input", async () => {
    const db = world({
      access: { shared_passcode_enabled: false },
      users: [
        {
          id: uuid(10), portal_access_id: uuid(1), engagement_id: ENG, email: "m@a.com", name: "M", role: "owner",
          passcode_hash: "x", passcode_salt: "y", active: true, revoked_at: null, last_login_at: null, login_count: 0, created_at: "2026-09-02T00:00:00Z",
        },
      ],
    });
    h.sb = db.sb;
    expect((await call({ engagementId: ENG, action: "deactivate", userId: uuid(10) })).status).toBe(409);
    expect((await call({ engagementId: "nope", action: "add" })).status).toBe(400);
    expect((await call({ engagementId: ENG, action: "add", name: "", email: "bad", role: "owner" })).status).toBe(400);
  });

  it("degrades when 069 is not applied (no table, no column)", async () => {
    const a: Row = {
      id: uuid(1), client_slug: "acme", engagement_id: ENG, active: true, revoked_at: null, display_name: "Acme",
    };
    h.sb = fakeDb({ client_portal_access: [a] }, { missingTables: ["portal_users"], missingColumns: { client_portal_access: ["shared_passcode_enabled"] } }).sb;
    const res = await call({ engagementId: ENG, action: "add", name: "M", email: "m@a.com", role: "owner" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "team_unavailable" });
  });
});

describe("audit verification badge", () => {
  const NOW = Date.parse("2026-10-02T15:00:00Z");
  const v = (extra: Partial<LatestVerification> = {}): LatestVerification => ({
    workspaceId: "ws1",
    verifiedAt: "2026-10-02T09:00:00Z",
    ok: true,
    rowsChecked: 1284,
    headHash: "9f2c4b7a1e3d5f60aabbccdd",
    ...extra,
  });

  it("states: none, ok, stale (36h), failed", () => {
    expect(verificationState(null, NOW)).toBe("none");
    expect(verificationState(v(), NOW)).toBe("ok");
    expect(verificationState(v({ verifiedAt: "2026-10-01T04:00:00Z" }), NOW)).toBe("ok"); // 35h
    expect(verificationState(v({ verifiedAt: "2026-10-01T02:00:00Z" }), NOW)).toBe("stale"); // 37h
    expect(verificationState(v({ ok: false }), NOW)).toBe("failed");
  });

  it("shows nothing when there is no data", () => {
    const s = summarizeVerifications([], NOW);
    expect(s.state).toBe("none");
    expect(verificationLine("en", s, { now: NOW, tz: "America/New_York" })).toBeNull();
  });

  it("says verified today with the event count and the first 12 chars of the fingerprint", () => {
    const line = verificationLine("en", summarizeVerifications([v()], NOW), { now: NOW, tz: "America/New_York" })!;
    expect(line.tone).toBe("ok");
    expect(line.text).toBe("Audit log verified today · 1284 events, none altered");
    expect(line.fingerprint).toBe("Chain fingerprint 9f2c4b7a1e3d");
    const es = verificationLine("es", summarizeVerifications([v()], NOW), { now: NOW, tz: "America/New_York" })!;
    expect(es.text).toBe("Registro de auditoría verificado hoy · 1284 eventos, ninguno alterado");
  });

  it("uses singular, and yesterday when the day has changed in the business zone", () => {
    const one = verificationLine("en", summarizeVerifications([v({ rowsChecked: 1 })], NOW), { now: NOW, tz: "America/New_York" })!;
    expect(one.text).toContain("1 event, none altered");
    const yesterday = verificationLine("en", summarizeVerifications([v({ verifiedAt: "2026-10-01T20:00:00Z" })], NOW), {
      now: NOW,
      tz: "America/New_York",
    })!;
    expect(yesterday.text).toContain("verified yesterday");
  });

  it("goes stale after 36 hours with the last verified date, and no fingerprint", () => {
    const old = v({ verifiedAt: "2026-09-29T09:00:00Z" });
    const s = summarizeVerifications([old], NOW);
    expect(s.state).toBe("stale");
    const line = verificationLine("en", s, { now: NOW, tz: "America/New_York" })!;
    expect(line.tone).toBe("stale");
    expect(line.text).toMatch(/^Last verified /);
    expect(line.text).toContain("29");
    expect(line.fingerprint).toBeNull();
    expect(verificationLine("es", s, { now: NOW, tz: "America/New_York" })!.text).toMatch(/^Última verificación: /);
  });

  it("a failed check is shown plainly, and one failed workspace fails the client", () => {
    const s = summarizeVerifications([v(), v({ workspaceId: "ws2", ok: false })], NOW);
    expect(s.state).toBe("failed");
    expect(s.fingerprint).toBeNull(); // several workspaces: no single fingerprint
    expect(verificationLine("en", s, { now: NOW, tz: "UTC" })!.tone).toBe("failed");
  });

  it("has Spanish and English strings without em dashes", () => {
    for (const k of ["verify.stale", "verify.failed", "verify.fingerprint", "verify.ok.one", "verify.ok.other", "ra.owner_only"]) {
      for (const lang of ["en", "es"] as const) expect(t(lang, k, { n: 2, when: "x", date: "x", hash: "x" })).not.toContain("—");
    }
    expect(t("en", "ra.owner_only")).toBe("Only the owner can approve");
    expect(t("es", "ra.owner_only")).toBe("Solo el dueño puede aprobar");
  });
});

describe("admin verification views", () => {
  const NOW = Date.parse("2026-10-02T15:00:00Z");
  const fresh: LatestVerification = { workspaceId: "ws_a", verifiedAt: "2026-10-02T13:00:00Z", ok: true, rowsChecked: 10, headHash: "abcdef0123456789" };
  const failed: LatestVerification = { ...fresh, workspaceId: "ws_b", ok: false };
  const stale: LatestVerification = { ...fresh, workspaceId: "ws_c", verifiedAt: "2026-09-28T00:00:00Z" };

  it("flags only failed and stale workspaces", () => {
    expect(verificationFlags([fresh, failed, stale], NOW)).toEqual([
      { workspaceId: "ws_b", state: "failed", verifiedAt: failed.verifiedAt },
      { workspaceId: "ws_c", state: "stale", verifiedAt: stale.verifiedAt },
    ]);
    expect(verificationFlags([], NOW)).toEqual([]);
  });

  it("builds an Overview row per agent workspace with data, none without", () => {
    const rows = verificationRows(
      [
        { name: "Front Desk", workspace_id: "ws_a" },
        { name: "Reviews", workspace_id: "ws_none" },
      ],
      new Map([["ws_a", fresh]]),
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agentName: "Front Desk", state: "ok", fingerprint: "abcdef012345" });
    expect(rows[0]!.text).toContain("10 events, none altered");
    expect(verificationRows([{ name: "A", workspace_id: "ws_a" }], new Map(), NOW)).toEqual([]);
  });

  it("puts a failed verification in Today as urgent and a stale one as attention", () => {
    const clients = new Map<string, ClientRef>([
      ["ws_b", { name: "Old Dental", scope: { kind: "engagement", engagementId: "eng-b" } }],
      ["ws_c", { name: "Naile Studio", scope: { kind: "account", accountId: "acc-c" } }],
    ]);
    const items = buildNeedsYou({
      now: NOW,
      dueTasks: [],
      approvals: [],
      clientsByWorkspace: clients,
      quietClients: [],
      failedCrons: [],
      escalations: null,
      verificationFlags: verificationFlags([fresh, failed, stale], NOW),
    });
    expect(items.map((i) => [i.kind, i.tone, i.title])).toEqual([
      ["verification", "critical", "Old Dental: audit log verification failed"],
      ["verification", "attention", "Naile Studio: audit log not verified recently"],
    ]);
  });
});
