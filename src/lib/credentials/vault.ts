import "server-only";
import { getServiceClient } from "@/lib/audit/client";
import { writeAuditEntry } from "@/lib/audit/writer";
import { encryptMessage, decryptMessage, encryptionAvailable } from "@/lib/portal/encrypt";

/**
 * Credential vault — application-layer AES-256-GCM.
 *
 * History: the original vault (mig 004) encrypted in-DB via pgsodium, which
 * fails in production ("permission denied for function crypto_aead_det_encrypt")
 * and is deprecated by Supabase. This implementation keeps the SAME interface
 * but encrypts in Node with the proven envelope used for conversation
 * transcripts (lib/portal/encrypt.ts, keyed by CONVERSATION_ENCRYPTION_KEY) and
 * stores base64 ciphertext in vault_credentials (mig 050). The DB never sees
 * plaintext. Every read is still audited.
 */

export type Provider =
  | "twilio"
  | "hubspot"
  | "quickbooks"
  | "google_business"
  | "sendgrid"
  | "stripe"
  | "servicetitan"
  | "microsoft_graph"
  | "gmail"
  // External booking backend (workspace owns its booking system; Loucells
  // delegates + mirrors). webhook_secret = shared HMAC secret;
  // account_identifier = the external app base URL.
  | "external_booking";

export type WriteInput = {
  workspace_id: string;
  provider: Provider;
  access_token?: string | null;
  refresh_token?: string | null;
  webhook_secret?: string | null;
  account_identifier?: string | null;
  scopes?: string[];
  expires_at?: Date | null;
};

export type ReadResult = {
  provider: Provider;
  access_token: string | null;
  refresh_token: string | null;
  webhook_secret: string | null;
  account_identifier: string | null;
  scopes: string[];
  expires_at: string | null;
};

/** Per-(workspace,provider) encryption context — the AES key salt. */
function ctx(workspaceId: string, provider: Provider): string {
  return `vault_v1::${workspaceId}::${provider}`;
}

function enc(workspaceId: string, provider: Provider, value?: string | null): string | null {
  if (value == null || value === "") return null;
  return encryptMessage(ctx(workspaceId, provider), value);
}

function dec(workspaceId: string, provider: Provider, cipher?: string | null): string | null {
  if (cipher == null || cipher === "") return null;
  try {
    return decryptMessage(ctx(workspaceId, provider), cipher);
  } catch {
    return null; // key rotated or corrupt — fail safe, caller handles missing
  }
}

export async function writeCredential(
  input: WriteInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!encryptionAvailable()) {
    return { ok: false, error: "CONVERSATION_ENCRYPTION_KEY missing — cannot encrypt credentials" };
  }
  const client = getServiceClient();
  if (!client) return { ok: false, error: "Supabase not configured" };

  const { data, error } = await client
    .from("vault_credentials")
    .upsert(
      {
        workspace_id: input.workspace_id,
        provider: input.provider,
        account_identifier: input.account_identifier ?? null,
        access_token_enc: enc(input.workspace_id, input.provider, input.access_token),
        refresh_token_enc: enc(input.workspace_id, input.provider, input.refresh_token),
        webhook_secret_enc: enc(input.workspace_id, input.provider, input.webhook_secret),
        scopes: input.scopes ?? [],
        expires_at: input.expires_at ? input.expires_at.toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,provider" },
    )
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "vault upsert failed" };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function readCredential(input: {
  workspace_id: string;
  provider: Provider;
  /** Why this token is being read — written to the audit log. */
  reason: string;
  /** Who is acting on behalf of the workspace (agent id, system process). */
  actor: string;
}): Promise<{ ok: true; credential: ReadResult } | { ok: false; error: string }> {
  const client = getServiceClient();
  if (!client) return { ok: false, error: "Supabase not configured" };

  const { data, error } = await client
    .from("vault_credentials")
    .select("provider, account_identifier, access_token_enc, refresh_token_enc, webhook_secret_enc, scopes, expires_at")
    .eq("workspace_id", input.workspace_id)
    .eq("provider", input.provider)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) {
    return {
      ok: false,
      error: `No credential found for workspace=${input.workspace_id} provider=${input.provider}`,
    };
  }

  const row = data as {
    provider: string;
    account_identifier: string | null;
    access_token_enc: string | null;
    refresh_token_enc: string | null;
    webhook_secret_enc: string | null;
    scopes: string[] | null;
    expires_at: string | null;
  };

  const credential: ReadResult = {
    provider: row.provider as Provider,
    access_token: dec(input.workspace_id, input.provider, row.access_token_enc),
    refresh_token: dec(input.workspace_id, input.provider, row.refresh_token_enc),
    webhook_secret: dec(input.workspace_id, input.provider, row.webhook_secret_enc),
    account_identifier: row.account_identifier,
    scopes: row.scopes ?? [],
    expires_at: row.expires_at,
  };

  // A stored ciphertext that fails to decrypt (e.g. key rotated/corrupt) must
  // fail loudly — never hand back a half-decrypted credential the caller would
  // treat as "not configured" or use as null.
  if (
    (row.access_token_enc && credential.access_token === null) ||
    (row.refresh_token_enc && credential.refresh_token === null) ||
    (row.webhook_secret_enc && credential.webhook_secret === null)
  ) {
    return { ok: false, error: "decrypt_failed" };
  }

  // Forensic record of the read — never the token itself.
  await writeAuditEntry({
    request_id: `vault_${crypto.randomUUID().slice(0, 8)}`,
    workspace_id: input.workspace_id,
    user_id: input.actor,
    role: "system",
    ip_address: null,
    source: "vault",
    decision: "ALLOW",
    blocked_by: null,
    reason: `vault_read provider=${input.provider} purpose="${input.reason}"`,
    sanitized_prompt_hash: "",
    plain_prompt_for_hash: `vault_read:${input.workspace_id}:${input.provider}`,
    redaction_summary: { vault_read: 1 },
  });

  return { ok: true, credential };
}
