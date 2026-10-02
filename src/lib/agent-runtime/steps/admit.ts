import "server-only";
import { sha256Hex } from "@/lib/crypto/hash";
import { parseSmsKeyword } from "@/lib/booking/gates";
import type { TurnContext } from "../context";
import type { TurnOutcome } from "../types";
import { optOutConfirmation, smsBudgetNotice, standdown, standdownAfterCompletion, webBudgetNotice } from "../copy";
import { dropPendingAction } from "./confirm";

/**
 * admit: may this turn run at all? In order:
 *   SMS keywords + opt-out (always honored, even when rate limited)
 *   → rate limits (cost / abuse) → owner take-over pause → monthly budget.
 * Every refusal leaves a DENY audit row.
 */

// Web: per (slug, IP) bucket + a per-slug ceiling that bounds an attacker
// rotating IPs across a botnet against one tenant (~1 req/s sustained).
const WEB_VISITOR = { capacity: 10, refillPerSec: 0.2 };
const WEB_GLOBAL = { capacity: 60, refillPerSec: 1 };
// SMS: per contact burst 6, ~6 per 10 min sustained. Per agent burst 60, 2/min.
const SMS_CONTACT = { capacity: 6, refillPerSec: 6 / 600 };
const SMS_AGENT = { capacity: 60, refillPerSec: 1 / 30 };

export async function admit(ctx: TurnContext): Promise<TurnOutcome | null> {
  return (await smsKeywords(ctx)) ?? (await rateLimits(ctx)) ?? (await takeoverPause(ctx)) ?? (await budget(ctx));
}

async function smsKeywords(ctx: TurnContext): Promise<TurnOutcome | null> {
  const conv = ctx.inbound.conv;
  if (conv.kind !== "contact") return null;
  const store = ctx.deps.store;
  const ws = ctx.config.workspaceId;
  const keyword = parseSmsKeyword(ctx.inbound.text);

  if (keyword?.kind === "opt_out") {
    await store?.optOut(ws, conv.phone);
    // A pending appointment change dies with the opt-out (a later YES is a re-subscribe, never a confirmation).
    await dropPendingAction(ctx);
    // Carrier keywords (STOP, CANCEL...) are blocked + confirmed by Twilio
    // Advanced Opt-Out. Ours (BAJA, PARAR, ALTO, CANCELAR, REVOKE, OPTOUT)
    // are not, so we send the single allowed confirmation (no marketing).
    return {
      kind: "suppressed",
      reason: "opt_out",
      text: keyword.carrierHandled ? undefined : optOutConfirmation(keyword.keyword, ctx.config.name),
    };
  }
  if (keyword?.kind === "opt_in" && conv.optedOut) {
    // Re-subscribed; Twilio confirms START/UNSTOP/YES. No AI reply on top.
    await store?.optIn(ws, conv.contactId);
    return { kind: "suppressed", reason: "opt_in" };
  }
  // Opted-out contact sent something that isn't a keyword: logged by claim,
  // but no AI and no reply (they asked us to stop texting).
  if (conv.optedOut) return { kind: "suppressed", reason: "opted_out" };
  return null;
}

async function rateLimits(ctx: TurnContext): Promise<TurnOutcome | null> {
  const { rateLimit } = ctx.deps;
  const slug = ctx.config.slug;
  const conv = ctx.inbound.conv;

  const [visitorKey, visitor, globalKey, global] =
    conv.kind === "contact"
      ? [`sms:${slug}:c:${sha256Hex(`${ctx.config.workspaceId}:${conv.phone}`).slice(0, 24)}`, SMS_CONTACT, `sms:${slug}:agent`, SMS_AGENT]
      : [`agent:${slug}:${ctx.inbound.ip ?? "unknown"}`, WEB_VISITOR, `agent:${slug}:global`, WEB_GLOBAL];

  // Global ceiling first: bounds the per-tenant blast radius.
  const g = await rateLimit(globalKey, global.capacity, global.refillPerSec);
  if (!g.allowed) {
    await ctx.audit({
      decision: "DENY",
      blocked_by: "rate_limited_global",
      reason: `slug=${slug} retry_after=${g.retryAfterSec}s`,
    });
    return { kind: "blocked", reason: "rate_limited", retryAfterSec: g.retryAfterSec };
  }
  const v = await rateLimit(visitorKey, visitor.capacity, visitor.refillPerSec);
  if (!v.allowed) {
    await ctx.audit({ decision: "DENY", blocked_by: "rate_limited", reason: `retry_after=${v.retryAfterSec}s` });
    return { kind: "blocked", reason: "rate_limited", retryAfterSec: v.retryAfterSec };
  }
  return null;
}

/** Has the owner taken this conversation over (portal take-over)? */
export async function isPaused(ctx: TurnContext): Promise<boolean> {
  const store = ctx.deps.store;
  if (!store) return false;
  try {
    return await store.isPaused(ctx.config.engagementId, ctx.sessionKey);
  } catch {
    return false;
  }
}

async function takeoverPause(ctx: TurnContext): Promise<TurnOutcome | null> {
  if (!(await isPaused(ctx))) return null;
  await ctx.audit({ decision: "DENY", blocked_by: "session_paused", reason: "owner_take_over" });
  // SMS: the owner is texting the customer; the agent stays silent.
  return { kind: "suppressed", reason: "paused", text: ctx.channel === "web" ? standdown(ctx.locale) : undefined };
}

/**
 * Final pause gate, right before the reply ships: the owner may have clicked
 * "take over" while the model was working. Returns the stand-down outcome.
 */
export async function pausedAfterCompletion(ctx: TurnContext): Promise<TurnOutcome | null> {
  if (!(await isPaused(ctx))) return null;
  await ctx.audit({ decision: "DENY", blocked_by: "session_paused", reason: "owner_take_over:after_completion" });
  return {
    kind: "suppressed",
    reason: "paused",
    text: ctx.channel === "web" ? standdownAfterCompletion(ctx.locale) : undefined,
  };
}

async function budget(ctx: TurnContext): Promise<TurnOutcome | null> {
  const { workspaceId, monthlyTokenBudget } = ctx.config;
  if (!(await ctx.deps.isBudgetExhausted(workspaceId, monthlyTokenBudget))) return null;
  await ctx.audit({ decision: "DENY", blocked_by: "budget_exhausted", reason: `monthly_budget=${monthlyTokenBudget}` });

  const conv = ctx.inbound.conv;
  if (conv.kind === "session") return { kind: "blocked", reason: "budget", text: webBudgetNotice(ctx.locale) };

  // SMS: at most one short notice per contact per day.
  const notice = smsBudgetNotice(ctx.locale, ctx.config.name);
  const since = new Date(ctx.deps.now() - 24 * 3600_000).toISOString();
  const already = (await ctx.deps.store?.sentRecently(workspaceId, conv.contactId, notice, since)) ?? false;
  return { kind: "blocked", reason: "budget", text: already ? undefined : notice };
}
