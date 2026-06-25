import "server-only";
import crypto from "node:crypto";
import { readCredential } from "@/lib/credentials/vault";

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
  if (!baseUrl || !secret) return null;
  return { baseUrl, secret };
}

export type AgentApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/** Call one of the external app's signed agent endpoints (POST + JSON). */
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
    console.error("callAgentApi failed", path, e);
    return { ok: false, status: 0, error: "network" };
  }
}
