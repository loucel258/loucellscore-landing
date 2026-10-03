import "server-only";
import { readCredential } from "@/lib/credentials/vault";
import { validateTwilioSignature, twilioWebhookUrls } from "@/lib/notify/twilio";
import { mintTicket, stirVerified } from "@/lib/voice/auth";
import { conversationRelayTwiml, dialTwiml, hangupTwiml, relayUrl, sayAndHangup } from "@/lib/voice/twiml";
import { toAgentConfig, type AgentConfig } from "../config";
import { createTurnContext } from "../context";
import { voiceNoAnswer, voiceUnavailable } from "../copy";
import type { Locale } from "../types";
import { voiceDeps, voiceLocale, type VoiceDeps } from "./voice";

/**
 * Twilio voice webhooks for the ConversationRelay provider.
 *
 *   /voice/incoming  call arrives → verify X-Twilio-Signature (the workspace's
 *                    own auth token, from the vault) → TwiML <Connect><ConversationRelay>
 *   /voice/after     the relay session ended (or the transfer <Dial> finished)
 *                    → <Dial> to the configured transfer number, or hang up
 *
 * Everything fails closed: voice off, agent not live, no gateway or secret
 * configured, no Twilio credentials → a polite message and hang up.
 */

export type TwilioVoiceDeps = VoiceDeps & {
  readCredential: typeof readCredential;
  gatewayUrl: () => string | undefined;
};

function twilioVoiceDeps(overrides?: Partial<TwilioVoiceDeps>): TwilioVoiceDeps {
  return { readCredential, gatewayUrl: () => process.env.VOICE_GATEWAY_URL, ...voiceDeps(overrides), ...(overrides ?? {}) } as TwilioVoiceDeps;
}

const xml = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" } });

async function readForm(req: Request): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  const form = await req.formData();
  for (const [k, v] of form.entries()) fields[k] = typeof v === "string" ? v : "";
  return fields;
}

/** true = signature valid. false = invalid. null = no credentials to check with. */
async function verify(
  deps: TwilioVoiceDeps,
  req: Request,
  config: AgentConfig,
  path: string,
  fields: Record<string, string>,
  reason: string,
): Promise<boolean | null> {
  const cred = await deps.readCredential({
    workspace_id: config.workspaceId,
    provider: "twilio",
    reason,
    actor: `voice:${config.slug}`,
  });
  const authToken = cred.ok ? cred.credential.access_token : null;
  if (!authToken) return null;
  const signature = req.headers.get("x-twilio-signature");
  return twilioWebhookUrls(req, path).some((url) => validateTwilioSignature({ authToken, url, params: fields, signature }));
}

export async function handleVoiceIncoming(req: Request, slug: string, overrides?: Partial<TwilioVoiceDeps>): Promise<Response> {
  const deps = twilioVoiceDeps(overrides);
  const agent = await deps.resolveAgent(slug);
  const config = agent ? toAgentConfig(agent) : null;
  if (!config) return xml(hangupTwiml());
  const locale: Locale = voiceLocale(config);
  const polite = () => xml(sayAndHangup(voiceUnavailable(locale, config.name), locale));

  const fields = await readForm(req);
  const ok = await verify(deps, req, config, `/api/agent/${slug}/voice/incoming`, fields, "verify inbound call signature");
  if (ok === false) return new Response("invalid signature", { status: 403 });
  if (ok === null) return polite();

  const v = config.integrations.voice;
  const key = deps.voiceKey();
  const url = relayUrl(deps.gatewayUrl());
  if (config.status !== "live" || !v.enabled || v.provider !== "twilio_cr" || !key || !url || !fields.CallSid) return polite();

  // The ticket binds this exact call: the gateway takes the caller's number and
  // its SHAKEN/STIR verification from here (Twilio-signed), never from the socket.
  const ticket = mintTicket(
    key,
    {
      slug,
      callSid: fields.CallSid ?? "",
      from: fields.From ?? "",
      to: fields.To ?? "",
      verified: stirVerified(fields.StirVerstat),
      maxMin: v.max_call_minutes,
    },
    Math.floor(deps.now() / 1000),
  );
  return xml(conversationRelayTwiml({ slug, url, ticket, config, locale }));
}

const TRANSFER_REASONS = new Set(["owner_transfer", "owner_take_over"]);

function parseHandoff(raw: string | undefined): { reason: string; target: string } | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { reason?: unknown; target?: unknown };
    return typeof d.reason === "string" ? { reason: d.reason, target: typeof d.target === "string" ? d.target : "" } : null;
  } catch {
    return null;
  }
}

export async function handleVoiceAfter(req: Request, slug: string, overrides?: Partial<TwilioVoiceDeps>): Promise<Response> {
  const deps = twilioVoiceDeps(overrides);
  const agent = await deps.resolveAgent(slug);
  const config = agent ? toAgentConfig(agent) : null;
  if (!config) return xml(hangupTwiml());

  const stage = new URL(req.url).searchParams.get("stage");
  const fields = await readForm(req);
  const path = `/api/agent/${slug}/voice/after${stage ? `?stage=${encodeURIComponent(stage)}` : ""}`;
  const ok = await verify(deps, req, config, path, fields, "verify call callback signature");
  if (ok === false) return new Response("invalid signature", { status: 403 });
  if (ok === null) return xml(hangupTwiml());

  const store = deps.store;
  const ws = config.workspaceId;
  const sid = fields.CallSid ?? "";
  const call = sid ? await store?.getVoiceCall?.(ws, sid).catch(() => null) : null;
  const locale: Locale = call?.language === "en" || call?.language === "es" ? call.language : voiceLocale(config);
  const nowIso = new Date(deps.now()).toISOString();

  // Transfer attempt finished.
  if (stage === "dial") {
    const status = fields.DialCallStatus ?? "";
    if (status === "completed" || status === "answered") {
      await store?.updateVoiceCall?.(ws, sid, { endedAt: nowIso, outcome: "transferred" });
      return xml(hangupTwiml());
    }
    // Nobody picked up: save a callback (no recording without consent).
    await recordCallback(deps, config, sid, fields.From ?? "", "transfer_no_answer");
    await store?.updateVoiceCall?.(ws, sid, { endedAt: nowIso, outcome: "escalated" });
    return xml(sayAndHangup(voiceNoAnswer(locale), locale));
  }

  // The relay session never worked (gateway down, bad ticket): the caller
  // must not get dead air. Apologize, save a callback, hang up.
  if (fields.SessionStatus === "failed") {
    console.error(`[voice] ${slug}: relay session failed`, fields.ErrorCode ?? "");
    await recordCallback(deps, config, sid, fields.From ?? "", "voice_session_failed");
    if (sid) await store?.updateVoiceCall?.(ws, sid, { endedAt: nowIso, outcome: "escalated" });
    return xml(sayAndHangup(voiceNoAnswer(locale), locale));
  }

  const duration = Number(fields.SessionDuration);
  if (sid && store?.updateVoiceCall) {
    await store.updateVoiceCall(ws, sid, {
      endedAt: nowIso,
      ...(Number.isFinite(duration) && duration >= 0 ? { durationSec: Math.round(duration) } : {}),
    });
  }

  const handoff = parseHandoff(fields.HandoffData);
  const number = config.integrations.voice.transfer_number;
  if (handoff && TRANSFER_REASONS.has(handoff.reason) && number && config.integrations.voice.enabled) {
    // The number comes from OUR config; the gateway's target must agree or is ignored.
    if (handoff.target === number) {
      return xml(dialTwiml({ slug, number, callerId: fields.To }));
    }
    console.warn(`[voice] ${slug}: handoff target did not match the configured transfer number; hanging up`);
  }
  return xml(hangupTwiml());
}

/** An escalation row + alert for a call nobody answered (no TurnContext of its own). */
async function recordCallback(deps: TwilioVoiceDeps, config: AgentConfig, callSid: string, from: string, reason: string): Promise<void> {
  const summary =
    reason === "voice_session_failed"
      ? "The phone agent could not take this call (voice service unavailable). Call them back."
      : "A caller asked for a person and nobody answered. Call them back.";
  try {
    const caller = /^\+[1-9]\d{7,14}$/.test(from) ? from : null;
    const contact = caller && deps.store ? await deps.store.getOrCreateContact(config.workspaceId, caller).catch(() => null) : null;
    const ctx = createTurnContext(
      {
        channel: "voice",
        agent: config,
        conv: { kind: "call", callSid, from: caller ?? "anonymous", ...(contact ? { contactId: contact.id } : {}) },
        text: "",
        locale: voiceLocale(config),
        receivedAt: new Date(deps.now()),
      },
      deps,
    );
    await ctx.escalate({ reason, summary });
    await ctx.audit({ decision: "ALLOW", reason: `escalation:${reason}` });
  } catch (e) {
    console.error("[voice] callback not recorded", e instanceof Error ? e.name : "error");
  }
}
