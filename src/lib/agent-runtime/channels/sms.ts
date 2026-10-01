import "server-only";
import { after } from "next/server";
import { readCredential } from "@/lib/credentials/vault";
import { sendSms, validateTwilioSignature, twilioWebhookUrls } from "@/lib/notify/twilio";
import { resolveAgent } from "@/lib/agents/resolver";
import { toAgentConfig, type AgentConfig } from "../config";
import { withDeps, type TurnDeps } from "../deps";
import { runTurn } from "../runtime";
import { redactHighRisk } from "../steps/screen";
import type { TurnOutcome } from "../types";

/**
 * Twilio inbound SMS adapter (per slug, so we know which client's auth token
 * signs the webhook).
 *
 *   sync:     resolve agent → verify X-Twilio-Signature → empty TwiML 200
 *   after():  contact (created first, so a STOP from a new number is
 *             honored) → runTurn (claim by MessageSid, keywords, opt-out,
 *             limits, budget, DLP, model) → reply via REST → log outbound
 *
 * Twilio gets its answer immediately, so slow model turns never trigger a
 * webhook retry; the turn has its own deadline inside the route's
 * maxDuration. Replies always go through the REST API (one outbound path).
 *
 * This is the ONLY module besides the proactive gate (lib/notify/proactive)
 * allowed to call sendSms: it answers a customer who just texted us, which
 * is not a proactive send. Consent / quiet hours don't apply; opt-out does.
 */

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
function twiml(): Response {
  return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
}

export type SmsDeps = TurnDeps & {
  resolveAgent: typeof resolveAgent;
  readCredential: typeof readCredential;
  sendSms: typeof sendSms;
  /** next/server after(): run the turn once the response is sent. */
  after: (task: () => Promise<void>) => void;
};

function smsDeps(overrides?: Partial<SmsDeps>): SmsDeps {
  return { resolveAgent, readCredential, sendSms, after, ...withDeps(overrides) };
}

export async function handleTwilioInbound(req: Request, slug: string, overrides?: Partial<SmsDeps>): Promise<Response> {
  const deps = smsDeps(overrides);
  const agent = await deps.resolveAgent(slug);
  if (!agent || agent.status !== "live") return twiml();
  const config = toAgentConfig(agent);
  if (!config) return twiml();

  const form = await req.formData();
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) fields[k] = typeof v === "string" ? v : "";

  // No credentials → can't verify → drop (fail closed).
  const cred = await deps.readCredential({
    workspace_id: config.workspaceId,
    provider: "twilio",
    reason: "verify inbound sms signature",
    actor: `front_desk:${slug}`,
  });
  const authToken = cred.ok ? cred.credential.access_token : null;
  if (!authToken) return twiml();

  const signature = req.headers.get("x-twilio-signature");
  const valid = twilioWebhookUrls(req, `/api/agent/${slug}/sms`).some((url) =>
    validateTwilioSignature({ authToken, url, params: fields, signature }),
  );
  if (!valid) return new Response("invalid signature", { status: 403 });

  const message = {
    from: fields.From ?? "",
    to: fields.To ?? "",
    body: (fields.Body ?? "").trim(),
    sid: fields.MessageSid ?? "",
    receivedAt: new Date(deps.now()),
  };
  if (!message.from || !message.body) return twiml();

  deps.after(async () => {
    try {
      await processInboundSms(deps, config, message);
    } catch (e) {
      console.error(`[front-desk-sms] ${slug} turn failed`, e instanceof Error ? e.name : "error");
    }
  });
  return twiml();
}

type InboundSms = { from: string; to: string; body: string; sid: string; receivedAt: Date };

export async function processInboundSms(deps: SmsDeps, config: AgentConfig, msg: InboundSms): Promise<TurnOutcome | null> {
  const store = deps.store;
  if (!store) return null;
  const ws = config.workspaceId;

  const contact = await store.getOrCreateContact(ws, msg.from);
  if (!contact) {
    // Keep the TCPA evidence even when the contact can't be resolved.
    await store.logMessage({
      workspaceId: ws,
      contactId: null,
      direction: "inbound",
      body: redactHighRisk(deps.sanitize, msg.body),
      providerSid: msg.sid || null,
    });
    return null;
  }

  const outcome = await runTurn(
    {
      channel: "sms",
      agent: config,
      conv: { kind: "contact", contactId: contact.id, phone: msg.from, optedOut: contact.opted_out },
      text: msg.body,
      dedupeKey: msg.sid || null,
      locale: config.locale ?? "es",
      receivedAt: msg.receivedAt,
    },
    deps,
  );
  if (outcome.kind === "blocked" && outcome.reason === "rate_limited") {
    console.warn(`[front-desk-sms] ${config.slug} rate_limited retry_after=${outcome.retryAfterSec ?? 0}s`);
  }

  const text = outcome.kind === "duplicate" ? "" : (outcome.text ?? "");
  // Reply from the number the customer texted, else the configured sender.
  const replyFrom = msg.to || config.smsFromNumber || "";
  if (text && replyFrom) {
    const sent = await deps.sendSms({
      workspaceId: ws,
      to: msg.from,
      from: replyFrom,
      body: text,
      actor: `front_desk:${config.slug}`,
    });
    await store.logMessage({
      workspaceId: ws,
      contactId: contact.id,
      direction: "outbound",
      body: text,
      providerSid: sent.ok ? sent.sid : null,
      status: sent.ok ? "sent" : "failed",
    });
  }
  return outcome;
}
