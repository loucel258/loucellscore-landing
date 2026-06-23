import "server-only";
import crypto from "node:crypto";
import { readCredential } from "@/lib/credentials/vault";

/**
 * Minimal Twilio SMS client over fetch — no SDK dep.
 *
 * Credentials are the CLIENT's, stored per-workspace in the encrypted vault
 * under provider "twilio":
 *   - account_identifier = Twilio Account SID  (ACxxxxxxxx)
 *   - access_token       = Twilio Auth Token
 * The `from` number is NOT a secret; it lives in the agent's config
 * (client_agents.integrations.reminders.from_number) and is passed in.
 *
 * Fails closed: if the workspace has no Twilio credential, returns
 * {ok:false, reason:"no_credential"} so a pre-launch agent never throws. Each
 * credential read is audited by the vault (forensic trace of token usage).
 */

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

export type SendSmsResult =
  | { ok: true; sid: string }
  | { ok: false; reason: "no_credential" | "no_from" | "send_failed"; error?: string };

export async function sendSms(args: {
  workspaceId: string;
  to: string; // E.164, e.g. +15615551234
  body: string;
  from: string; // E.164 sender number (from agent config)
  /** Why we're sending — written to the vault read audit. */
  actor: string;
}): Promise<SendSmsResult> {
  if (!args.from) return { ok: false, reason: "no_from" };

  const cred = await readCredential({
    workspace_id: args.workspaceId,
    provider: "twilio",
    reason: `send_sms to ${maskPhone(args.to)}`,
    actor: args.actor,
  });
  if (!cred.ok) return { ok: false, reason: "no_credential", error: cred.error };

  const sid = cred.credential.account_identifier;
  const token = cred.credential.access_token;
  if (!sid || !token) {
    return { ok: false, reason: "no_credential", error: "Twilio SID/token missing in vault" };
  }

  const params = new URLSearchParams({ To: args.to, From: args.from, Body: args.body });
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  try {
    const res = await fetch(`${TWILIO_BASE}/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, reason: "send_failed", error: `${res.status}: ${errBody.slice(0, 200)}` };
    }
    const data = (await res.json()) as { sid?: string };
    return { ok: true, sid: data.sid ?? "unknown" };
  } catch (e) {
    return { ok: false, reason: "send_failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/** "+15615551234" -> "••1234" — for logs/idempotency, never store the full number. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `••${digits.slice(-4)}` : "••";
}

/**
 * Verify an inbound Twilio webhook's X-Twilio-Signature.
 * Twilio signs base64(HMAC-SHA1(authToken, url + each sorted POST key+value)).
 * The url must be exactly the public URL Twilio posted to.
 */
export function validateTwilioSignature(args: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | null;
}): boolean {
  if (!args.authToken || !args.signature) return false;
  const data = Object.keys(args.params)
    .sort()
    .reduce((acc, k) => acc + k + args.params[k], args.url);
  const expected = crypto
    .createHmac("sha1", args.authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(args.signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Best-effort E.164 normalizer for US numbers parsed from free text. */
export function toE164US(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+") && digits.length >= 11) return `+${digits}`;
  return null;
}
