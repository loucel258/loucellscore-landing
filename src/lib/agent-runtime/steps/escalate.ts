import "server-only";
import type { TurnContext } from "../context";
import { sanitize } from "@/lib/dlp/sanitizer";

/**
 * escalate: hand the conversation to a person.
 *   1. write an `escalations` row (durable queue; migration 060). Until that
 *      table exists (42P01 / PGRST205) the row is skipped silently and the
 *      alert email below is the hand-off, exactly as before.
 *   2. send the internal alert.
 * `notified` is what customer-facing copy may rely on ("a person will get
 * back to you"); `recorded` says the row landed.
 */

export type EscalationRequest = {
  reason: string;
  summary: string;
  /** Web only: what the visitor shared, for the alert. */
  visitor?: { name?: string; email?: string };
};

export type EscalationResult = { recorded: boolean; notified: boolean };

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
let warnedMissingTable = false;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function writeRow(ctx: TurnContext, req: EscalationRequest): Promise<boolean> {
  const store = ctx.deps.store;
  if (!store) return false;
  const conv = ctx.inbound.conv;
  try {
    const err = await store.insertEscalation({
      workspace_id: ctx.config.workspaceId,
      agent_slug: ctx.config.slug,
      channel: ctx.channel,
      session_id: conv.kind === "session" ? conv.sessionId : null,
      contact_id: conv.kind === "contact" ? conv.contactId : null,
      reason: req.reason.slice(0, 80),
      // Stored DLP-masked: the model writes this summary and may repeat a
      // name, email or card number. The contact stays reachable through
      // session_id / contact_id. (The internal alert email keeps it raw.)
      summary: sanitize(req.summary).sanitized.slice(0, 500),
    });
    if (!err) return true;
    if (MISSING_TABLE.has(err.code ?? "")) {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn("[agent-runtime] escalations table missing (migration 060 pending); alert email only");
      }
      return false;
    }
    console.warn(`[agent-runtime] escalation row not written: ${err.code ?? "error"}`);
    return false;
  } catch (e) {
    console.warn("[agent-runtime] escalation row not written:", e instanceof Error ? e.name : "error");
    return false;
  }
}

function alertFor(ctx: TurnContext, req: EscalationRequest): { subject: string; bodyHtml: string } {
  const slug = ctx.config.slug;
  if (ctx.channel === "web") {
    return {
      subject: `[Escalation] ${req.reason} — agent ${slug}`,
      bodyHtml: `
          <p>The agent <strong>${slug}</strong> escalated a conversation to a human.</p>
          <p><strong>Reason:</strong> ${escapeHtml(req.reason)}</p>
          <p><strong>Summary:</strong> ${escapeHtml(req.summary)}</p>
          <p><strong>Visitor:</strong> ${escapeHtml(req.visitor?.name ?? "(no name)")} · ${escapeHtml(req.visitor?.email ?? "(no email)")}</p>
          <p style="color:#888;font-size:11px;">session ${escapeHtml(ctx.sessionKey)} · transcript in /admin</p>
        `,
    };
  }
  // The SMS body is attacker-controlled; everything is escaped before it
  // reaches the owner's HTML inbox.
  return {
    subject: `Front Desk escalation — ${slug}`,
    bodyHtml: `<p>The Front Desk agent escalated a conversation.</p><p><b>Reason:</b> ${escapeHtml(req.reason)}</p><p><b>Summary:</b> ${escapeHtml(req.summary)}</p><p>Workspace: ${escapeHtml(ctx.config.workspaceId)}</p>`,
  };
}

export async function escalate(ctx: TurnContext, req: EscalationRequest): Promise<EscalationResult> {
  const recorded = await writeRow(ctx, req);
  let notified = false;
  try {
    const alert = await ctx.deps.sendAlert(alertFor(ctx, req));
    notified = alert.ok;
    if (!alert.ok) console.warn(`[agent-runtime] escalation alert not delivered for ${ctx.config.slug}: ${alert.reason}`);
  } catch (e) {
    console.error("[agent-runtime] escalation alert failed", e instanceof Error ? e.name : "error");
  }
  return { recorded, notified };
}
