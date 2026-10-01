import "server-only";
import crypto from "node:crypto";
import { readCredential } from "@/lib/credentials/vault";
import { readBookingConfig } from "@/lib/agents/booking-config";

/**
 * Client side of the external booking integration (the "phone line" to a
 * workspace's own booking app, e.g. Naile Studio). Same HMAC scheme as the
 * external app: signature = HMAC-SHA256(`${timestamp}.${rawBody}`), all calls
 * POST + JSON. The per-workspace secret + base URL live in the vault under the
 * `external_booking` provider — its presence IS the "this workspace delegates
 * booking" switch.
 */

export type BookingBackend = { baseUrl: string; secret: string };

const MAX_SKEW_SEC = 300;
/** Hard ceiling per external call so a hung booking app can't stall a turn. */
export const AGENT_API_TIMEOUT_MS = 8_000;

function sign(secret: string, ts: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

export function signedHeaders(secret: string, body: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  return {
    "content-type": "application/json",
    "x-agent-timestamp": ts,
    "x-agent-signature": sign(secret, ts, body),
  };
}

/** Verify an inbound signed event from the external booking app. */
export function verifyInbound(secret: string, req: Request, rawBody: string): boolean {
  const ts = req.headers.get("x-agent-timestamp");
  const got = req.headers.get("x-agent-signature");
  if (!ts || !got) return false;
  const skew = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(skew) || skew > MAX_SKEW_SEC) return false;
  const expected = sign(secret, ts, rawBody);
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Resolve a workspace's external booking backend — the per-workspace switch.
 * Returns null when the workspace uses Loucells' own booking (the default), so
 * callers fall back to local logic and other tenants are untouched.
 */
export async function getExternalBookingBackend(
  workspaceId: string,
): Promise<BookingBackend | null> {
  const cred = await readCredential({
    workspace_id: workspaceId,
    provider: "external_booking",
    reason: "resolve external booking backend",
    actor: "system:booking",
  });
  if (!cred.ok) return null;
  const baseUrl = cred.credential.account_identifier?.replace(/\/+$/, "");
  const secret = cred.credential.webhook_secret;
  // Fail closed on a missing/weak shared secret (must match the external app's >=16).
  if (!baseUrl || !secret || secret.length < 16) return null;
  return { baseUrl, secret };
}

/**
 * How a workspace books appointments, decided ONCE per turn:
 *   - external:             call the workspace's own app (source of truth)
 *   - external_unavailable: it is (or may be) external, but the credentials
 *                           can't be read right now. Booking must FAIL CLOSED:
 *                           never fall back to local Postgres, or a customer
 *                           gets "you're booked" while the business never
 *                           sees the appointment.
 *   - local:                Loucells Postgres booking
 *   - link:                 no API booking; customers use the booking link
 */
export type BookingBackendResolution =
  | { mode: "external"; backend: BookingBackend }
  | { mode: "external_unavailable"; reason: string }
  | { mode: "local" }
  | { mode: "link"; linkUrl: string | null };

// vault.ts reports a missing row with this prefix (vs. a DB error or
// decrypt_failed). Only a confirmed-missing row may be read as "local".
const NO_CREDENTIAL_RE = /^No credential found/;

/**
 * Resolve the workspace's booking backend from the agent's explicit
 * `integrations.booking.mode` when set, else by the backward-compatible
 * vault inference (credential present = external). Fails closed: anything
 * that MIGHT be external but can't be read resolves to external_unavailable.
 */
export async function resolveBookingBackend(
  workspaceId: string,
  integrations?: unknown,
): Promise<BookingBackendResolution> {
  const cfg = readBookingConfig(integrations);
  if (cfg.mode === "local") return { mode: "local" };
  if (cfg.mode === "link") return { mode: "link", linkUrl: cfg.linkUrl };

  const cred = await readCredential({
    workspace_id: workspaceId,
    provider: "external_booking",
    reason: "resolve external booking backend",
    actor: "system:booking",
  });
  if (!cred.ok) {
    // Explicitly external, or a vault error we can't classify: fail closed.
    if (cfg.mode === "external" || !NO_CREDENTIAL_RE.test(cred.error)) {
      return {
        mode: "external_unavailable",
        reason: cfg.mode === "external" && NO_CREDENTIAL_RE.test(cred.error)
          ? "credential_missing"
          : "credential_unreadable",
      };
    }
    return { mode: "local" };
  }
  const baseUrl = cred.credential.account_identifier?.replace(/\/+$/, "");
  const secret = cred.credential.webhook_secret;
  // A row exists, so this workspace delegates booking. A missing/weak shared
  // secret (must match the external app's >=16) means misconfigured, not
  // local: fail closed.
  if (!baseUrl || !secret || secret.length < 16) {
    return { mode: "external_unavailable", reason: "credential_invalid" };
  }
  return { mode: "external", backend: { baseUrl, secret } };
}

export type AgentApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/**
 * Call one of the external app's signed agent endpoints (POST + JSON).
 * Bounded by AGENT_API_TIMEOUT_MS; a timeout returns { ok:false, error:"timeout" }.
 */
export async function callAgentApi<T = unknown>(
  backend: BookingBackend,
  path: string,
  payload: unknown,
): Promise<AgentApiResult<T>> {
  const body = JSON.stringify(payload ?? {});
  try {
    const res = await fetch(`${backend.baseUrl}${path}`, {
      method: "POST",
      headers: signedHeaders(backend.secret, body),
      body,
      signal: AbortSignal.timeout(AGENT_API_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof json.error === "string" ? json.error : `http_${res.status}`,
      };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    console.error("callAgentApi failed", path, timedOut ? "timeout" : e instanceof Error ? e.name : "error");
    return { ok: false, status: 0, error: timedOut ? "timeout" : "network" };
  }
}
