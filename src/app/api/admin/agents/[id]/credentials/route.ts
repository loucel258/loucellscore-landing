import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { writeCredential, type Provider } from "@/lib/credentials/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin credential management for a client agent. Stores a client's API
 * keys (Twilio, Google Business, etc.) in the encrypted vault, scoped to the
 * agent's workspace. Secrets are WRITE-ONLY through this endpoint — GET only
 * returns WHICH providers are configured, never the values.
 */

const PROVIDERS = [
  "twilio",
  "google_business",
  "hubspot",
  "quickbooks",
  "servicetitan",
  "sendgrid",
  "stripe",
  "microsoft_graph",
  "gmail",
] as const;

const InputSchema = z.object({
  provider: z.enum(PROVIDERS),
  account_identifier: z.string().max(300).nullable().optional(),
  access_token: z.string().max(4000).nullable().optional(),
  refresh_token: z.string().max(4000).nullable().optional(),
  webhook_secret: z.string().max(500).nullable().optional(),
});

async function resolveWorkspace(
  id: string,
): Promise<{ workspaceId: string; name: string } | null> {
  const sb = getServiceClient();
  if (!sb) return null;
  const { data } = await sb
    .from("client_agents")
    .select("workspace_id, name, engagement_ref")
    .eq("id", id)
    .maybeSingle();
  const row = data as { workspace_id?: string; name?: string; engagement_ref?: string } | null;
  if (!row?.workspace_id) return null;
  return { workspaceId: row.workspace_id, name: row.name || row.engagement_ref || "Client" };
}

/**
 * The vault's client_credentials FKs to clients(workspace_id). Agent
 * workspaces don't get a clients row at creation, so ensure one exists
 * (idempotent) before writing a credential. Requires migration 048 so the
 * longer agent workspace_id passes the clients CHECK.
 */
async function ensureClientRow(workspaceId: string, name: string): Promise<void> {
  const sb = getServiceClient();
  if (!sb) return;
  await sb
    .from("clients")
    .upsert({ workspace_id: workspaceId, name }, { onConflict: "workspace_id", ignoreDuplicates: true });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });

  const ws = await resolveWorkspace(id);
  if (!ws) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // Provider names only — never the encrypted blobs.
  const { data } = await sb
    .from("client_credentials")
    .select("provider, account_identifier, updated_at")
    .eq("workspace_id", ws.workspaceId);

  return NextResponse.json({ ok: true, configured: data ?? [] });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let input: z.infer<typeof InputSchema>;
  try {
    input = InputSchema.parse(await req.json());
  } catch (err) {
    const detail = err instanceof z.ZodError ? err.issues[0]?.message : undefined;
    return NextResponse.json({ ok: false, error: "invalid_input", detail }, { status: 400 });
  }

  const ws = await resolveWorkspace(id);
  if (!ws) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  await ensureClientRow(ws.workspaceId, ws.name);

  const result = await writeCredential({
    workspace_id: ws.workspaceId,
    provider: input.provider as Provider,
    account_identifier: input.account_identifier ?? null,
    access_token: input.access_token ?? null,
    refresh_token: input.refresh_token ?? null,
    webhook_secret: input.webhook_secret ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "vault_write_failed", detail: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, provider: input.provider });
}
