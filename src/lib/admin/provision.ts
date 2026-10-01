import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashPasscode, generatePasscodeSalt } from "@/lib/portal/auth";
import { canonicalizeOrigin } from "@/lib/agents/resolver";
import { getAdminSettings } from "./settings";
import { engagementAuditWorkspace, writeAdminAudit } from "./audit";
import { isUniqueViolation } from "./db-errors";
import { deriveSlug, slugCandidate, originsFromWebsite } from "./slug";
import { clientHref } from "./client-routes";
import {
  buildEngagementRef,
  idempotencyTag,
  type AgentType,
  type NewClientInput,
  type ProvisionResponse,
  type ProvisionStep,
} from "./client-intake";

/**
 * Server-side creation of accounts, engagements, agents and portal access.
 * The single-purpose admin routes (engagements/create, agents/create,
 * portal-access/create) and the New client flow (clients/create) all call
 * these, so the rules live in one place. Every function takes the service
 * client: these are writes.
 */

// ── Passcodes ────────────────────────────────────────────────────────

/** 16 chars, easy to read aloud (no 0/O/1/l/I), grouped 4-4-4-4. */
export function generatePasscode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i]! % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

// ── Accounts ─────────────────────────────────────────────────────────

/**
 * Exact, case-insensitive account lookup by contact email. New rows are
 * stored lowercased, so `.eq` on the lowercased value is the fast path.
 * Rows backfilled by migration 044 kept the original casing, so a second
 * pass narrows with ILIKE and then requires an exact lowercase match in
 * code: ILIKE alone treats "_" and "%" as wildcards and could hand back
 * someone else's account.
 */
export async function findAccountIdByEmail(
  sb: SupabaseClient,
  email: string,
): Promise<{ id: string | null; error: string | null }> {
  const exact = await sb.from("crm_accounts").select("id").eq("primary_contact_email", email).limit(1);
  if (exact.error) return { id: null, error: exact.error.message };
  const hit = (exact.data as Array<{ id: string }> | null)?.[0];
  if (hit) return { id: hit.id, error: null };

  const loose = await sb
    .from("crm_accounts")
    .select("id, primary_contact_email")
    .ilike("primary_contact_email", email)
    .limit(50);
  if (loose.error) return { id: null, error: loose.error.message };
  const match = ((loose.data as Array<{ id: string; primary_contact_email: string | null }> | null) ?? []).find(
    (r) => r.primary_contact_email?.toLowerCase() === email,
  );
  return { id: match?.id ?? null, error: null };
}

export type AccountResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; error: "account_lookup_failed" | "account_unresolved"; detail?: string };

/**
 * Find-or-create by contact email, so a returning client (audit, then a
 * build, then a second agent) keeps one account.
 */
export async function findOrCreateAccount(
  sb: SupabaseClient,
  input: {
    name: string;
    email: string;
    contactName?: string | null;
    phone?: string | null;
    vertical?: string | null;
    language: "en" | "es";
  },
): Promise<AccountResult> {
  const email = input.email.toLowerCase();
  const found = await findAccountIdByEmail(sb, email);
  if (found.error) {
    console.warn("[provision] account lookup failed:", found.error);
    return { ok: false, error: "account_lookup_failed", detail: found.error };
  }
  if (found.id) return { ok: true, id: found.id, created: false };

  const { data: created, error } = await sb
    .from("crm_accounts")
    .insert({
      account_name: input.name,
      primary_contact_name: input.contactName || input.name,
      primary_contact_email: email,
      primary_contact_phone: input.phone || null,
      vertical: input.vertical ?? null,
      language: input.language,
      lifecycle: "prospect",
    })
    .select("id")
    .single();
  if (created) return { ok: true, id: (created as { id: string }).id, created: true };

  if (isUniqueViolation(error)) {
    // Lost a race with a concurrent create for the same email (unique
    // index on lower(primary_contact_email)): use the winner's row.
    const again = await findAccountIdByEmail(sb, email);
    if (again.id) return { ok: true, id: again.id, created: false };
  } else if (error) {
    console.warn("[provision] account insert failed:", error.message);
  }
  return { ok: false, error: "account_unresolved", detail: error?.message };
}

// ── Engagements ──────────────────────────────────────────────────────

export type EngagementRowInput = {
  engagement_ref: string;
  account_id: string;
  lead_id?: string | null;
  client_legal_name: string;
  client_email: string;
  vertical: string | null;
  language: "en" | "es";
  engagement_type: "gap_audit" | "smv_build" | "integration_control";
  audit_fee_cents: number;
  credit_amount_cents?: number;
  notes: string | null;
  status: string;
};

export type EngagementResult =
  | { ok: true; id: string; ref: string }
  | { ok: false; error: "insert_failed" | "duplicate_ref"; detail?: string };

/**
 * Insert one engagement. On a duplicate engagement_ref, "suffix" retries
 * once with "-2" (two audits for the same initials on one day); "report"
 * returns duplicate_ref so an idempotent caller can pick up the first row.
 */
export async function insertEngagement(
  sb: SupabaseClient,
  row: EngagementRowInput,
  onDuplicateRef: "suffix" | "report",
): Promise<EngagementResult> {
  const { data, error } = await sb.from("engagements").insert(row).select("id, engagement_ref").single();
  if (!error && data) {
    const d = data as { id: string; engagement_ref: string };
    return { ok: true, id: d.id, ref: d.engagement_ref };
  }
  console.warn("[provision] engagement insert failed:", error?.message);
  if (isUniqueViolation(error)) {
    if (onDuplicateRef === "report") return { ok: false, error: "duplicate_ref" };
    const retry = await sb
      .from("engagements")
      .insert({ ...row, engagement_ref: `${row.engagement_ref}-2` })
      .select("id, engagement_ref")
      .single();
    if (retry.error || !retry.data) {
      return { ok: false, error: "insert_failed", detail: retry.error?.message };
    }
    const d = retry.data as { id: string; engagement_ref: string };
    return { ok: true, id: d.id, ref: d.engagement_ref };
  }
  return { ok: false, error: "insert_failed", detail: error?.message };
}

// ── Agents ───────────────────────────────────────────────────────────

function normalizeForWorkspace(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export type AgentCreateInput = {
  engagementId: string;
  name: string;
  agentType: AgentType;
  slug: string;
  allowedOrigins?: string[];
  systemPrompt?: string;
  greetingMessage?: string;
  brandColor?: string;
  monthlyTokenBudget?: number;
};

export type AgentResult =
  | { ok: true; id: string; workspaceId: string; slug: string }
  | {
      ok: false;
      error: "engagement_not_found" | "slug_taken" | "invalid_origin" | "insert_failed";
      status: number;
      detail?: string;
    };

/**
 * Create a client agent in 'designing'. Go-live happens through the update
 * endpoint, which enforces the readiness gate.
 *
 *   workspace_id = ws_client_<engagement_ref normalized>_<slug normalized>
 */
export async function createAgent(sb: SupabaseClient, input: AgentCreateInput): Promise<AgentResult> {
  const { data: engData } = await sb
    .from("engagements")
    .select("id, engagement_ref")
    .eq("id", input.engagementId)
    .maybeSingle();
  if (!engData) return { ok: false, error: "engagement_not_found", status: 404 };
  const engagementRef = (engData as { engagement_ref: string }).engagement_ref;

  // Slug must be globally unique (it's the public URL identity).
  const { data: slugTaken } = await sb
    .from("client_agents")
    .select("id")
    .eq("slug", input.slug)
    .limit(1)
    .maybeSingle();
  if (slugTaken) return { ok: false, error: "slug_taken", status: 409 };

  const canonical: string[] = [];
  for (const raw of input.allowedOrigins ?? []) {
    const c = canonicalizeOrigin(raw);
    if (!c) return { ok: false, error: "invalid_origin", status: 400, detail: raw };
    if (!canonical.includes(c)) canonical.push(c);
  }

  const workspaceId = `ws_client_${normalizeForWorkspace(engagementRef)}_${normalizeForWorkspace(input.slug)}`;

  // Defaults for new agents (token budget, data retention) come from
  // /admin/settings; an explicit value still wins.
  const { defaultMonthlyBudget, defaultRetentionDays } = await getAdminSettings();

  const { data: created, error } = await sb
    .from("client_agents")
    .insert({
      engagement_id: input.engagementId,
      engagement_ref: engagementRef,
      name: input.name,
      agent_type: input.agentType,
      status: "designing",
      workspace_id: workspaceId,
      slug: input.slug,
      allowed_origins: canonical,
      system_prompt: input.systemPrompt ?? null,
      greeting_message: input.greetingMessage ?? null,
      brand_color: input.brandColor ?? null,
      monthly_token_budget: input.monthlyTokenBudget ?? defaultMonthlyBudget,
      conversation_retention_days: defaultRetentionDays,
      channels: ["chat_widget"],
      integrations: {},
    })
    .select("id")
    .single();

  if (error || !created) {
    // The slug (and the workspace derived from it) are unique: a
    // concurrent create with the same slug lands here.
    if (isUniqueViolation(error)) return { ok: false, error: "slug_taken", status: 409 };
    return { ok: false, error: "insert_failed", status: 500, detail: error?.message };
  }
  return { ok: true, id: (created as { id: string }).id, workspaceId, slug: input.slug };
}

// ── Portal access ────────────────────────────────────────────────────

export type PortalResult =
  | { ok: true; clientSlug: string; passcode: string }
  | { ok: false; error: "slug_taken" | "insert_failed"; status: number; detail?: string };

/**
 * Provision portal access for an engagement. The passcode is returned once
 * and stored only as a salted hash.
 */
export async function createPortalAccess(
  sb: SupabaseClient,
  input: { engagementId: string; clientSlug: string; displayName: string; passcode?: string },
): Promise<PortalResult> {
  const passcode = input.passcode ?? generatePasscode();
  const salt = generatePasscodeSalt();
  const hash = hashPasscode(passcode, salt);

  const { error } = await sb.from("client_portal_access").insert({
    engagement_id: input.engagementId,
    client_slug: input.clientSlug,
    passcode_hash: hash,
    passcode_salt: salt,
    display_name: input.displayName,
  });
  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "slug_taken", status: 409, detail: "That client_slug is already in use." };
    }
    return { ok: false, error: "insert_failed", status: 500, detail: error.message };
  }

  await writeAdminAudit({
    workspaceId: await engagementAuditWorkspace(sb, input.engagementId),
    reason: `portal_access_created:${input.clientSlug}`,
  });
  return { ok: true, clientSlug: input.clientSlug, passcode };
}

// ── New client: account -> engagement -> agent -> portal ─────────────

const MAX_SLUG_ATTEMPTS = 10;

async function agentForEngagement(
  sb: SupabaseClient,
  engagementId: string,
): Promise<{ row: { id: string; slug: string | null; workspace_id: string } | null; error: string | null }> {
  const { data, error } = await sb
    .from("client_agents")
    .select("id, slug, workspace_id")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return { row: null, error: error.message };
  return { row: (data as Array<{ id: string; slug: string | null; workspace_id: string }> | null)?.[0] ?? null, error: null };
}

async function portalForEngagement(
  sb: SupabaseClient,
  engagementId: string,
): Promise<{ row: { id: string; client_slug: string } | null; error: string | null }> {
  const { data, error } = await sb
    .from("client_portal_access")
    .select("id, client_slug")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return { row: null, error: error.message };
  return { row: (data as Array<{ id: string; client_slug: string }> | null)?.[0] ?? null, error: null };
}

/**
 * Create everything a new client needs, in order, and report each step.
 *
 * Idempotent per form submission: the engagement reference carries a tag
 * from the form's idempotency key and engagement_ref is unique, so a retry
 * (double tap, network drop, "Try again" after a partial failure) finds the
 * engagement it already made and resumes from the first missing piece. The
 * account is find-or-create by email; the agent and the portal are looked
 * up by engagement before anything is created.
 */
export async function provisionNewClient(sb: SupabaseClient, input: NewClientInput): Promise<ProvisionResponse> {
  const steps: ProvisionStep[] = [];
  const out: ProvisionResponse = { ok: false, steps };
  const fail = (step: ProvisionStep["step"], error: string, detail?: string): ProvisionResponse => {
    steps.push({ step, status: "failed", detail: detail ?? error });
    const order: ProvisionStep["step"][] = ["account", "engagement", "agent", "portal"];
    for (const s of order.slice(order.indexOf(step) + 1)) steps.push({ step: s, status: "skipped" });
    return { ...out, ok: false, failedStep: step, error, detail };
  };

  const email = input.ownerEmail.toLowerCase();

  // 1. Account
  const account = await findOrCreateAccount(sb, {
    name: input.businessName,
    contactName: input.ownerName,
    email,
    phone: input.ownerPhone || null,
    vertical: input.vertical,
    language: input.language,
  });
  if (!account.ok) return fail("account", account.error, account.detail);
  out.accountId = account.id;
  out.clientHref = clientHref({ kind: "account", accountId: account.id }, { tab: "setup" });
  steps.push({
    step: "account",
    status: account.created ? "created" : "reused",
    id: account.id,
    detail: account.created ? undefined : "An account with this owner email already existed.",
  });

  // 2. Engagement (idempotent through the tagged, unique engagement_ref)
  const tag = idempotencyTag(input.idempotencyKey);
  const findTagged = async () => {
    const { data, error } = await sb
      .from("engagements")
      .select("id, engagement_ref, account_id")
      .like("engagement_ref", `BLD-%-${tag}`)
      .limit(1);
    return {
      row: (data as Array<{ id: string; engagement_ref: string; account_id: string | null }> | null)?.[0] ?? null,
      error: error?.message ?? null,
    };
  };
  let tagged = await findTagged();
  if (tagged.error) return fail("engagement", "lookup_failed", tagged.error);
  let engagementStatus: "created" | "reused" = "reused";
  if (!tagged.row) {
    const inserted = await insertEngagement(
      sb,
      {
        engagement_ref: buildEngagementRef(input.businessName, { prefix: "BLD", tag }),
        account_id: account.id,
        client_legal_name: input.businessName,
        client_email: email,
        vertical: input.vertical,
        language: input.language,
        engagement_type: "smv_build",
        audit_fee_cents: 0,
        credit_amount_cents: 0,
        notes: null,
        // An agent build that is being set up: no SOW/Stripe webhooks drive it.
        status: "in_progress",
      },
      "report",
    );
    if (inserted.ok) {
      tagged = { row: { id: inserted.id, engagement_ref: inserted.ref, account_id: account.id }, error: null };
      engagementStatus = "created";
    } else if (inserted.error === "duplicate_ref") {
      tagged = await findTagged(); // a concurrent submit of this same form won
    } else {
      return fail("engagement", inserted.error, inserted.detail);
    }
  }
  const engagement = tagged.row;
  if (!engagement) return fail("engagement", "engagement_unresolved");
  if (engagement.account_id !== account.id) {
    return fail(
      "engagement",
      "idempotency_conflict",
      "This form already created a client under a different owner email. Open that client, or start over.",
    );
  }
  out.engagementId = engagement.id;
  out.engagementRef = engagement.engagement_ref;
  steps.push({ step: "engagement", status: engagementStatus, id: engagement.id, detail: engagement.engagement_ref });

  // 3. Agent
  let agent = await agentForEngagement(sb, engagement.id);
  if (agent.error) return fail("agent", "lookup_failed", agent.error);
  let agentStatus: "created" | "reused" = "reused";
  if (!agent.row) {
    const base = deriveSlug(input.businessName);
    const origins = originsFromWebsite(input.website);
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS && !agent.row; attempt++) {
      const slug = slugCandidate(base, attempt);
      // New clients use one address for the widget and the portal, so the
      // portal namespace has to be free as well.
      const { data: portalTaken, error: portalErr } = await sb
        .from("client_portal_access")
        .select("id")
        .eq("client_slug", slug)
        .limit(1);
      if (portalErr) return fail("agent", "lookup_failed", portalErr.message);
      if ((portalTaken as unknown[] | null)?.length) continue;

      const created = await createAgent(sb, {
        engagementId: engagement.id,
        name: input.businessName,
        agentType: input.agentType,
        slug,
        allowedOrigins: origins,
      });
      if (created.ok) {
        agent = { row: { id: created.id, slug: created.slug, workspace_id: created.workspaceId }, error: null };
        agentStatus = "created";
        await writeAdminAudit({ workspaceId: created.workspaceId, reason: `client_provisioned:${created.slug}` });
      } else if (created.error === "slug_taken") {
        // Either another client owns it, or a concurrent submit of this
        // form just created our agent: check before trying the next slug.
        agent = await agentForEngagement(sb, engagement.id);
        if (agent.error) return fail("agent", "lookup_failed", agent.error);
      } else {
        return fail("agent", created.error, created.detail);
      }
    }
    if (!agent.row) return fail("agent", "no_free_slug", `No free address near "${base}". Create the agent from Setup.`);
  }
  const agentRow = agent.row;
  out.agentId = agentRow.id;
  out.agentSlug = agentRow.slug ?? undefined;
  steps.push({ step: "agent", status: agentStatus, id: agentRow.id, detail: agentRow.slug ?? undefined });

  // 4. Portal access
  let portal = await portalForEngagement(sb, engagement.id);
  if (portal.error) return fail("portal", "lookup_failed", portal.error);
  if (portal.row) {
    out.portalSlug = portal.row.client_slug;
    steps.push({
      step: "portal",
      status: "reused",
      id: portal.row.id,
      detail: "Already set up. Rotate the passcode in Setup to get a new one.",
    });
  } else {
    const baseSlug = agentRow.slug ?? deriveSlug(input.businessName);
    const candidates = [baseSlug, `${baseSlug}-portal`, `${baseSlug}-portal-2`, `${baseSlug}-portal-3`];
    for (const clientSlug of candidates) {
      const created = await createPortalAccess(sb, {
        engagementId: engagement.id,
        clientSlug,
        displayName: input.businessName,
      });
      if (created.ok) {
        out.portalSlug = created.clientSlug;
        out.passcode = created.passcode;
        steps.push({ step: "portal", status: "created", detail: created.clientSlug });
        break;
      }
      if (created.error !== "slug_taken") return fail("portal", created.error, created.detail);
      portal = await portalForEngagement(sb, engagement.id);
      if (portal.error) return fail("portal", "lookup_failed", portal.error);
      if (portal.row) {
        out.portalSlug = portal.row.client_slug;
        steps.push({ step: "portal", status: "reused", id: portal.row.id, detail: "Created by a parallel submit." });
        break;
      }
    }
    if (!out.portalSlug) return fail("portal", "slug_taken", "No free portal address. Create portal access from Setup.");
  }

  out.ok = true;
  return out;
}
