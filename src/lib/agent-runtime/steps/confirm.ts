import "server-only";
import { sha256Hex } from "@/lib/crypto/hash";
import type { TurnContext } from "../context";
import type { Step } from "../runtime";
import { actionDeclinedReply } from "../copy";
import { isExpired, parseConfirmationReply, parsePendingAction, type PendingAction } from "../pending-action";
import { runConfirmedAction } from "../tools/booking";
import { prepareBooking } from "./booking";

/**
 * confirmPending (SMS, after admit + screen, before any model call): settle
 * the customer's reply to a stored customer_confirm action.
 *
 *   no pending action / web          → null (the turn continues)
 *   expired                          → cleared, null (the turn continues)
 *   exact YES / SÍ / CONFIRMO / OK…  → take it (compare-and-swap), run it
 *                                      through the booking dispatch, reply
 *   exact NO / NO GRACIAS            → take it, reply "nothing was changed"
 *   anything else                    → kept, shown to the model, null
 *
 * Opt-out / opt-in keywords never get here: admit() handles them first.
 * Taking the action BEFORE running it means a second YES (or a Twilio-level
 * duplicate that slipped past claim) finds nothing to run.
 */
export async function confirmPending(ctx: TurnContext): Promise<Step | null> {
  const conv = ctx.inbound.conv;
  const store = ctx.deps.store;
  if (ctx.channel !== "sms" || conv.kind !== "contact" || !store) return null;
  const ws = ctx.config.workspaceId;

  let action: PendingAction | null;
  try {
    action = parsePendingAction(await store.getPendingAction(ws, conv.contactId));
  } catch {
    return null;
  }
  if (!action) return null;

  if (isExpired(action, ctx.deps.now())) {
    await take(ctx, action);
    await ctx.audit({ decision: "ALLOW", reason: `pending_action_expired:${action.tool}` });
    return null;
  }

  const reply = parseConfirmationReply(ctx.inbound.text);
  if (!reply) {
    ctx.pendingAction = action;
    return null;
  }

  if (!(await take(ctx, action))) {
    // Another turn (a second YES sent at the same time) already took it.
    await ctx.audit({ decision: "ALLOW", reason: `pending_action_already_taken:${action.tool}` });
    return { outcome: { kind: "duplicate" } };
  }

  // Reply in the language of the word they used; OK / NO fall back to the agent's.
  const locale = reply.locale ?? ctx.locale;
  if (reply.kind === "decline") {
    await ctx.audit({
      decision: "ALLOW",
      reason: `customer_declined:${action.tool}`,
      contentHash: sha256Hex(JSON.stringify(action.input)),
    });
    return {
      draft: {
        kind: "reply",
        text: actionDeclinedReply(locale),
        auditReply: true,
        replyReason: "assistant_reply:confirmation_declined",
        toolSummary: `Customer declined ${action.tool}`,
      },
    };
  }

  await prepareBooking(ctx);
  const run = await runConfirmedAction(ctx, action, locale);
  const escalation = ctx.escalation;
  return {
    draft: {
      kind: escalation?.result.notified ? "escalated" : "reply",
      text: run.text,
      auditReply: true,
      replyReason: run.ok ? "assistant_reply:confirmation_done" : "assistant_reply:confirmation_failed",
      toolSummary: run.toolSummary,
      escalationReason: escalation?.reason,
    },
  };
}

async function take(ctx: TurnContext, action: PendingAction): Promise<boolean> {
  const conv = ctx.inbound.conv;
  if (conv.kind !== "contact" || !ctx.deps.store) return false;
  try {
    return await ctx.deps.store.takePendingAction(ctx.config.workspaceId, conv.contactId, action.id);
  } catch {
    return false;
  }
}

/** Opt-out: drop any pending action so a later YES (re-subscribe) can never run it. Best-effort. */
export async function dropPendingAction(ctx: TurnContext): Promise<void> {
  const conv = ctx.inbound.conv;
  const store = ctx.deps.store;
  if (conv.kind !== "contact" || !store) return;
  try {
    const action = parsePendingAction(await store.getPendingAction(ctx.config.workspaceId, conv.contactId));
    if (action) await store.takePendingAction(ctx.config.workspaceId, conv.contactId, action.id);
  } catch {
    // Expiry (30 min) still bounds it.
  }
}
