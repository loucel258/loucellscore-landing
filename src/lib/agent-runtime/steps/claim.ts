import "server-only";
import type { TurnContext } from "../context";
import { redactHighRisk } from "./screen";

/**
 * claim: make sure a provider message is processed once.
 *
 * SMS: the inbound messages_log row (TCPA evidence) is inserted FIRST and the
 * insert itself is the claim: a Twilio retry of the same MessageSid hits the
 * unique index (migration 061) → 23505 → "duplicate". High-risk PII (card,
 * SSN...) is redacted before it is stored.
 *
 * Web: the widget sends no nonce, so there is nothing to claim.
 */
export async function claim(ctx: TurnContext): Promise<"claimed" | "duplicate"> {
  const conv = ctx.inbound.conv;
  if (conv.kind !== "contact") return "claimed";
  const store = ctx.deps.store;
  if (!store) return "claimed";
  const res = await store.claimInbound({
    workspaceId: ctx.config.workspaceId,
    contactId: conv.contactId,
    body: redactHighRisk(ctx.deps.sanitize, ctx.inbound.text),
    providerSid: ctx.inbound.dedupeKey || null,
  });
  if (res.status === "duplicate") return "duplicate";
  ctx.claimedId = res.id;
  return "claimed";
}
