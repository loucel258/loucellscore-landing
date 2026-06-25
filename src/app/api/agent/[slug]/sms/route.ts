import { getServiceClient } from "@/lib/audit/client";
import { readCredential } from "@/lib/credentials/vault";
import { sendSms, validateTwilioSignature } from "@/lib/notify/twilio";
import { getOrCreateContact, setOptedOut, recordConsent } from "@/lib/booking/contacts";
import { isOptOutMessage, isOptInMessage } from "@/lib/booking/gates";
import { runFrontDeskTurn, type ServiceLite } from "@/lib/booking/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound SMS webhook for a Front Desk agent (per-slug so we know which
 * client's Twilio auth token to verify against). Pipeline:
 *   verify X-Twilio-Signature → log inbound → opt-out/opt-in → resolve contact
 *   → orchestrate (Haiku escalate filter + Sonnet tool loop) → reply via REST
 *   → log outbound. Consent/quiet-hours gates are NOT applied here (those guard
 *   PROACTIVE sends); replying to a customer who texted us is always allowed,
 *   except after opt-out.
 *
 * Returns empty TwiML 200 — the reply is sent via the Twilio REST API so there
 * is one outbound path and no TwiML timeout coupling.
 */

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
function twiml() {
  return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
}

type AgentRow = {
  workspace_id: string;
  name: string;
  status: string;
  integrations: Record<string, unknown> | null;
};

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = getServiceClient();
  if (!sb) return twiml();

  const { data } = await sb
    .from("client_agents")
    .select("workspace_id, name, status, integrations")
    .eq("slug", slug)
    .maybeSingle();
  const agent = data as AgentRow | null;
  if (!agent || agent.status !== "live") return twiml();

  const ws = agent.workspace_id;

  // ── Parse Twilio form body + verify signature ────────────────────────────
  const form = await req.formData();
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) fields[k] = typeof v === "string" ? v : "";

  const cred = await readCredential({
    workspace_id: ws,
    provider: "twilio",
    reason: "verify inbound sms signature",
    actor: `front_desk:${slug}`,
  });
  const authToken = cred.ok ? cred.credential.access_token : null;
  if (!authToken) return twiml(); // no creds → can't verify → drop

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const url = `https://${host}/api/agent/${slug}/sms`;
  const valid = validateTwilioSignature({
    authToken,
    url,
    params: fields,
    signature: req.headers.get("x-twilio-signature"),
  });
  if (!valid) return new Response("invalid signature", { status: 403 });

  const fromPhone = fields.From ?? "";
  const toPhone = fields.To ?? "";
  const body = (fields.Body ?? "").trim();
  if (!fromPhone || !body) return twiml();

  // ── Log inbound (TCPA evidence) ──────────────────────────────────────────
  await logMessage(sb, ws, fromPhone, "inbound", body, fields.MessageSid);

  // ── Opt-out / opt-in (carrier-keyword mirror) ────────────────────────────
  if (isOptOutMessage(body)) {
    await setOptedOut(sb, { workspaceId: ws, phone: fromPhone, source: "sms_stop" });
    return twiml(); // Twilio Advanced Opt-Out sends the confirmation
  }

  const contact = await getOrCreateContact(sb, { workspaceId: ws, phone: fromPhone });
  if (!contact) return twiml();

  if (isOptInMessage(body) && contact.opted_out) {
    await sb
      .from("contacts")
      .update({ opted_out: false, updated_at: new Date().toISOString() })
      .eq("workspace_id", ws)
      .eq("id", contact.id);
    await recordConsent(sb, {
      workspaceId: ws,
      contactId: contact.id,
      type: "transactional",
      granted: true,
      source: "sms_optin",
    });
  }

  // ── Build context + orchestrate ──────────────────────────────────────────
  const integ = (agent.integrations ?? {}) as Record<string, unknown>;
  const calendar = (integ.calendar ?? {}) as Record<string, unknown>;
  const timezone =
    typeof calendar.timezone === "string" ? calendar.timezone : contact.timezone ?? "America/New_York";
  const locale = integ.locale === "en" ? "en" : "es";
  const kb = typeof integ.kb === "string" ? integ.kb : undefined;

  const { data: svcRows } = await sb
    .from("services")
    .select("id, name, duration_min, price_cents")
    .eq("workspace_id", ws)
    .eq("active", true)
    .limit(50);
  const services = (svcRows as ServiceLite[]) ?? [];

  // Recent history (exclude the just-logged inbound).
  const { data: histRows } = await sb
    .from("messages_log")
    .select("direction, body, created_at")
    .eq("workspace_id", ws)
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false })
    .limit(11);
  const history = ((histRows as { direction: string; body: string }[]) ?? [])
    .slice(1) // drop the current inbound we just logged
    .reverse()
    .filter((m) => m.body)
    .map((m) => ({ role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const), content: m.body }));

  // Backfill contact_id on the inbound row we logged (logMessage looked it up).
  const result = await runFrontDeskTurn(sb, {
    agentSlug: slug,
    workspaceId: ws,
    contactId: contact.id,
    timezone,
    calendarId: typeof calendar.calendar_id === "string" ? calendar.calendar_id : null,
    locale,
    salonName: agent.name,
    services,
    kb,
    history,
    message: body,
    contactPhone: fromPhone,
  });

  // ── Reply via REST + log outbound ────────────────────────────────────────
  const reminders = (integ.reminders ?? {}) as Record<string, unknown>;
  const fromCfg = typeof reminders.from_number === "string" ? reminders.from_number : "";
  const replyFrom = toPhone || fromCfg || "";
  if (replyFrom && result.reply) {
    const sent = await sendSms({
      workspaceId: ws,
      to: fromPhone,
      from: replyFrom,
      body: result.reply,
      actor: `front_desk:${slug}`,
    });
    await logMessage(sb, ws, fromPhone, "outbound", result.reply, sent.ok ? sent.sid : undefined, sent.ok ? "sent" : "failed");
  }

  return twiml();
}

async function logMessage(
  sb: ReturnType<typeof getServiceClient>,
  workspaceId: string,
  phone: string,
  direction: "inbound" | "outbound",
  body: string,
  providerSid?: string,
  status?: string,
): Promise<void> {
  if (!sb) return;
  // Resolve contact_id best-effort (may not exist yet on first inbound).
  const { data } = await sb
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("phone", phone)
    .maybeSingle();
  await sb.from("messages_log").insert({
    workspace_id: workspaceId,
    contact_id: (data as { id: string } | null)?.id ?? null,
    channel: "sms",
    direction,
    body,
    provider_sid: providerSid ?? null,
    status: status ?? null,
  });
}
