import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, uuid, type Row } from "./fake-db";

const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sb: null as unknown,
  allowed: true,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (h.jar.has(n) ? { value: h.jar.get(n)! } : undefined),
    set: (n: string, v: string) => void h.jar.set(n, v),
    delete: (n: string) => void h.jar.delete(n),
  }),
}));
vi.mock("@/lib/audit/client", () => ({ getServiceClient: () => h.sb }));
vi.mock("@/lib/rate-limit/limiter", () => ({
  rateLimit: async () => ({ allowed: h.allowed, retryAfterSec: 60 }),
}));

import {
  cookieName,
  generatePasscodeSalt,
  getPortalSession,
  hashPasscode,
  mintPortalSession,
  verifyPortalToken,
} from "@/lib/portal/auth";
import { POST as login } from "@/app/api/portal/[slug]/login/route";
import {
  actorAuditId,
  actorAuditRole,
  actorDeciderId,
  can,
  sharedActor,
  userActor,
} from "@/lib/portal/roles";
import { sharedAccessAllowed, userAllowsSession } from "@/lib/portal/session-rules";
import { isOperatorActor } from "@/lib/admin/audit-actors";

const SLUG = "acme";
const SALT = "ab".repeat(16);
const SHARED = "SHARED-CODE-1234";
const MARIA = "MARIA-CODE-5678";
const SAM = "SAM-CODE-9012";

function access(extra: Row = {}): Row {
  return {
    id: uuid(1),
    client_slug: SLUG,
    engagement_id: uuid(2),
    display_name: "Acme",
    active: true,
    revoked_at: null,
    preferred_language: null,
    created_at: "2026-09-01T00:00:00Z",
    sessions_valid_after: null,
    shared_passcode_enabled: true,
    login_count: 0,
    passcode_salt: SALT,
    passcode_hash: hashPasscode(SHARED, SALT),
    ...extra,
  };
}

function person(id: number, email: string, name: string, role: string, code: string, extra: Row = {}): Row {
  return {
    id: uuid(id),
    portal_access_id: uuid(1),
    engagement_id: uuid(2),
    email,
    name,
    role,
    passcode_salt: SALT,
    passcode_hash: hashPasscode(code, SALT),
    active: true,
    revoked_at: null,
    last_login_at: null,
    login_count: 0,
    sessions_valid_after: null,
    ...extra,
  };
}

function seed(extra: { access?: Row; users?: Row[] } = {}) {
  return {
    client_portal_access: [extra.access ?? access()],
    portal_users: extra.users ?? [
      person(10, "maria@acme.com", "Maria", "owner", MARIA),
      person(11, "sam@acme.com", "Sam", "staff", SAM),
    ],
  };
}

async function signIn(body: Record<string, unknown>) {
  const res = await login(
    new Request("http://x/api/portal/acme/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: SLUG }) },
  );
  return { status: res.status, body: (await res.json()) as { ok: boolean; error?: string } };
}

beforeEach(() => {
  process.env.PORTAL_SESSION_SECRET = "test-secret";
  h.jar.clear();
  h.allowed = true;
});

describe("roles and actors", () => {
  it("owner can do everything; staff cannot approve, export or manage the team", () => {
    for (const p of ["decide_approvals", "export", "manage_team", "view_plan", "take_over", "write_notes"] as const) {
      expect(can("owner", p)).toBe(true);
    }
    for (const p of ["decide_approvals", "export", "manage_team", "view_plan"] as const) expect(can("staff", p)).toBe(false);
    for (const p of ["view_home", "view_inbox", "take_over", "view_customers", "write_notes", "view_approvals"] as const) {
      expect(can("staff", p)).toBe(true);
    }
    expect(can(null, "view_home")).toBe(false);
  });

  it("builds the audit identity: person vs shared access", () => {
    const maria = userActor({ id: uuid(10), name: "Maria", email: "maria@acme.com", role: "owner" });
    expect(actorAuditId(SLUG, maria)).toBe(`portal:acme:${uuid(10)}`);
    expect(actorDeciderId(SLUG, maria)).toBe(uuid(10));
    expect(actorAuditRole(maria)).toBe("owner");
    const shared = sharedActor();
    expect(actorAuditId(SLUG, shared)).toBe("portal:acme");
    expect(actorDeciderId(SLUG, shared)).toBe("portal:acme");
    expect(shared).toMatchObject({ userId: null, role: "owner", label: "Shared access" });
    // Falls back to the email when the person has no name.
    expect(userActor({ id: uuid(1), name: null, email: "x@y.com", role: "staff" }).name).toBe("x@y.com");
  });

  it("keeps the portal: prefix an operator actor (not a customer session)", () => {
    expect(isOperatorActor("portal:acme")).toBe(true);
    expect(isOperatorActor(`portal:acme:${uuid(10)}`)).toBe(true);
  });
});

describe("per-user session rules", () => {
  const iat = Math.floor(Date.parse("2026-10-01T12:00:00Z") / 1000);
  it("needs an active, unrevoked person", () => {
    expect(userAllowsSession(null, iat)).toBe(false);
    expect(userAllowsSession({ active: false, revoked_at: null }, iat)).toBe(false);
    expect(userAllowsSession({ active: true, revoked_at: "2026-09-01T00:00:00Z" }, iat)).toBe(false);
    expect(userAllowsSession({ active: true, revoked_at: null }, iat)).toBe(true);
  });
  it("ends tokens issued before the person's sessions_valid_after", () => {
    const base = { active: true, revoked_at: null };
    expect(userAllowsSession({ ...base, sessions_valid_after: "2026-10-01T12:00:01Z" }, iat)).toBe(false);
    expect(userAllowsSession({ ...base, sessions_valid_after: "2026-10-01T11:59:59Z" }, iat)).toBe(true);
    expect(userAllowsSession({ ...base, sessions_valid_after: "garbage" }, iat)).toBe(false);
  });
  it("shared passcode is on unless explicitly false (column missing = on)", () => {
    expect(sharedAccessAllowed({ shared_passcode_enabled: false })).toBe(false);
    expect(sharedAccessAllowed({ shared_passcode_enabled: true })).toBe(true);
    expect(sharedAccessAllowed({})).toBe(true);
    expect(sharedAccessAllowed(null)).toBe(true);
  });
});

describe("session tokens", () => {
  it("mints v1 (shared) and v2 (person) tokens that verify", () => {
    const v1 = mintPortalSession(SLUG)!;
    expect(v1.split(".")).toHaveLength(3);
    expect(verifyPortalToken(SLUG, v1)).toMatchObject({ userId: null });
    const v2 = mintPortalSession(SLUG, uuid(10))!;
    expect(v2.startsWith("v2.")).toBe(true);
    expect(verifyPortalToken(SLUG, v2)).toMatchObject({ userId: uuid(10) });
  });

  it("rejects tampered tokens, a swapped user id and other slugs", () => {
    const v2 = mintPortalSession(SLUG, uuid(11))!;
    const parts = v2.split(".");
    parts[3] = uuid(10); // pretend to be Maria
    expect(verifyPortalToken(SLUG, parts.join("."))).toBeNull();
    expect(verifyPortalToken("other", v2)).toBeNull();
    expect(verifyPortalToken(SLUG, "v2.1.2.3")).toBeNull();
    expect(verifyPortalToken(SLUG, "garbage")).toBeNull();
  });
});

describe("login", () => {
  it("signs a person in with email + their own passcode (v2 session, stats updated)", async () => {
    const db = fakeDb(seed());
    h.sb = db.sb;
    const r = await signIn({ email: "  Maria@Acme.com ", passcode: MARIA });
    expect(r.status).toBe(200);
    const token = h.jar.get(cookieName(SLUG))!;
    expect(verifyPortalToken(SLUG, token)).toMatchObject({ userId: uuid(10) });
    expect(db.tables.portal_users![0]).toMatchObject({ login_count: 1 });
    expect(db.tables.portal_users![0]!.last_login_at).toBeTruthy();
    const session = await getPortalSession(SLUG);
    expect(session?.actor).toMatchObject({ userId: uuid(10), name: "Maria", role: "owner" });
  });

  it("rejects a wrong passcode and another person's passcode", async () => {
    h.sb = fakeDb(seed()).sb;
    expect((await signIn({ email: "maria@acme.com", passcode: "nope" })).status).toBe(401);
    expect((await signIn({ email: "maria@acme.com", passcode: SAM })).status).toBe(401);
    expect(h.jar.size).toBe(0);
  });

  it("keeps the shared passcode working with a blank email (acts as owner, shown as shared access)", async () => {
    h.sb = fakeDb(seed()).sb;
    expect((await signIn({ passcode: SHARED })).status).toBe(200);
    const token = h.jar.get(cookieName(SLUG))!;
    expect(verifyPortalToken(SLUG, token)).toMatchObject({ userId: null });
    const session = await getPortalSession(SLUG);
    expect(session?.actor).toMatchObject({ userId: null, role: "owner", label: "Shared access" });
  });

  it("an unknown email falls back to the shared passcode, and never to a person's passcode", async () => {
    h.sb = fakeDb(seed()).sb;
    expect((await signIn({ email: "typo@acme.com", passcode: SHARED })).status).toBe(200);
    h.jar.clear();
    expect((await signIn({ email: "typo@acme.com", passcode: MARIA })).status).toBe(401);
  });

  it("refuses the shared passcode once it is switched off, but people still sign in", async () => {
    h.sb = fakeDb(seed({ access: access({ shared_passcode_enabled: false }) })).sb;
    expect((await signIn({ passcode: SHARED })).status).toBe(401);
    expect((await signIn({ email: "maria@acme.com", passcode: SHARED })).status).toBe(401);
    expect((await signIn({ email: "maria@acme.com", passcode: MARIA })).status).toBe(200);
  });

  it("refuses a deactivated or revoked person, even with the right passcode", async () => {
    h.sb = fakeDb(
      seed({
        users: [
          person(10, "maria@acme.com", "Maria", "owner", MARIA, { active: false }),
          person(11, "sam@acme.com", "Sam", "staff", SAM, { revoked_at: "2026-09-30T00:00:00Z" }),
        ],
      }),
    ).sb;
    expect((await signIn({ email: "maria@acme.com", passcode: MARIA })).status).toBe(401);
    expect((await signIn({ email: "sam@acme.com", passcode: SAM })).status).toBe(401);
    // And the shared passcode is not a back door for a deactivated person who types their email.
    expect((await signIn({ email: "maria@acme.com", passcode: SHARED })).status).toBe(401);
  });

  it("refuses a revoked portal for everyone", async () => {
    h.sb = fakeDb(seed({ access: access({ revoked_at: "2026-09-30T00:00:00Z" }) })).sb;
    expect((await signIn({ passcode: SHARED })).status).toBe(401);
    expect((await signIn({ email: "maria@acme.com", passcode: MARIA })).status).toBe(401);
  });

  it("keeps rate limiting", async () => {
    h.sb = fakeDb(seed()).sb;
    h.allowed = false;
    expect((await signIn({ passcode: SHARED })).status).toBe(429);
  });

  it("degrades while migration 069 is not applied: the shared passcode works as before", async () => {
    const a = access();
    delete a.shared_passcode_enabled;
    h.sb = fakeDb(
      { client_portal_access: [a] },
      { missingTables: ["portal_users"], missingColumns: { client_portal_access: ["shared_passcode_enabled"] } },
    ).sb;
    expect((await signIn({ passcode: SHARED })).status).toBe(200);
    h.jar.clear();
    // An email typed on a portal with no team yet: still the shared passcode.
    expect((await signIn({ email: "maria@acme.com", passcode: SHARED })).status).toBe(200);
    const session = await getPortalSession(SLUG);
    expect(session?.actor.label).toBe("Shared access");
  });
});

describe("sessions", () => {
  it("an old v1 token stays valid as shared access / owner", async () => {
    h.sb = fakeDb(seed()).sb;
    h.jar.set(cookieName(SLUG), mintPortalSession(SLUG)!);
    const s = await getPortalSession(SLUG);
    expect(s?.user).toBeNull();
    expect(s?.actor).toMatchObject({ userId: null, role: "owner" });
  });

  it("v1 tokens end when the shared passcode is switched off", async () => {
    h.sb = fakeDb(seed({ access: access({ shared_passcode_enabled: false }) })).sb;
    h.jar.set(cookieName(SLUG), mintPortalSession(SLUG)!);
    expect(await getPortalSession(SLUG)).toBeNull();
  });

  it("enforces the person's own active / revoked / sessions_valid_after", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    for (const [extra, ok] of [
      [{}, true],
      [{ active: false }, false],
      [{ revoked_at: "2026-09-30T00:00:00Z" }, false],
      [{ sessions_valid_after: future }, false],
      [{ sessions_valid_after: "2020-01-01T00:00:00Z" }, true],
    ] as Array<[Row, boolean]>) {
      h.sb = fakeDb(seed({ users: [person(10, "maria@acme.com", "Maria", "owner", MARIA, extra)] })).sb;
      h.jar.set(cookieName(SLUG), mintPortalSession(SLUG, uuid(10))!);
      expect((await getPortalSession(SLUG)) !== null).toBe(ok);
    }
  });

  it("still applies the portal-level rules to person sessions", async () => {
    h.jar.set(cookieName(SLUG), mintPortalSession(SLUG, uuid(10))!);
    h.sb = fakeDb(seed({ access: access({ active: false }) })).sb;
    expect(await getPortalSession(SLUG)).toBeNull();
    h.sb = fakeDb(seed({ access: access({ sessions_valid_after: new Date(Date.now() + 60_000).toISOString() }) })).sb;
    expect(await getPortalSession(SLUG)).toBeNull();
  });

  it("fails closed for a person token when the user is gone or the table is missing", async () => {
    h.jar.set(cookieName(SLUG), mintPortalSession(SLUG, uuid(99))!);
    h.sb = fakeDb(seed()).sb;
    expect(await getPortalSession(SLUG)).toBeNull();
    h.jar.set(cookieName(SLUG), mintPortalSession(SLUG, uuid(10))!);
    h.sb = fakeDb({ client_portal_access: [access()] }, { missingTables: ["portal_users"] }).sb;
    expect(await getPortalSession(SLUG)).toBeNull();
  });

  it("a person's token does not work with another portal's user (scoped to the access row)", async () => {
    h.sb = fakeDb(seed({ users: [person(10, "maria@acme.com", "Maria", "owner", MARIA, { portal_access_id: uuid(77) })] })).sb;
    h.jar.set(cookieName(SLUG), mintPortalSession(SLUG, uuid(10))!);
    expect(await getPortalSession(SLUG)).toBeNull();
  });
});

describe("hashing", () => {
  it("per-user salts differ", () => {
    expect(generatePasscodeSalt()).not.toBe(generatePasscodeSalt());
  });
});
