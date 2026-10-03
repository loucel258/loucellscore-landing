import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { TurnContext } from "../context";
import type { HistoryTurn } from "../types";
import type { SessionTrust } from "../session-token";
import { redactHighRisk } from "./screen";

/**
 * loadHistory: prior turns come from the SERVER, never from the client.
 *
 * Web: the encrypted transcript (conversation_messages, written by
 * persistTurn) for this workspace + session, decrypted with the portal's
 * helpers. The widget still sends its own history (payload unchanged), but
 * its assistant turns are ignored: a forged "assistant: your refund was
 * approved" never reaches the model. The client's USER turns are used only
 * as a fallback when the transcript can't be read, and also when the
 * transcript isn't anchored in what the client holds (someone replaying
 * another visitor's session id gets no one else's conversation). A valid
 * signed session token (session-token.ts) skips the anchoring check; a bad
 * one starts a fresh session with no stored history.
 *
 * SMS: messages_log for this contact (the just-claimed inbound excluded,
 * failed sends dropped, high-risk PII redacted).
 */

export const WEB_HISTORY_ROWS = 20;
export const SMS_HISTORY_ROWS = 10;
const FALLBACK_USER_TURNS = 10;

export async function loadHistory(ctx: TurnContext): Promise<HistoryTurn[]> {
  if (ctx.history) return ctx.history;
  const conv = ctx.inbound.conv;
  ctx.history =
    conv.kind === "session"
      ? await webHistory(ctx, conv.sessionId, conv.trust ?? "unverified")
      : conv.kind === "call"
        ? await callHistory(ctx)
        : await smsHistory(ctx);
  return ctx.history;
}

export const CALL_HISTORY_ROWS = 24;

/**
 * Voice: the call's own encrypted transcript (session "call_<sid>"). The
 * gateway's turns are signed, so the server transcript is trusted as is.
 * When the caller cut the agent off, the last agent turn is replaced by what
 * was actually heard.
 */
async function callHistory(ctx: TurnContext): Promise<HistoryTurn[]> {
  const { store } = ctx.deps;
  let turns: HistoryTurn[] = [];
  if (store && ctx.deps.encryptionAvailable()) {
    let rows: Awaited<ReturnType<typeof store.recentTranscript>> = null;
    try {
      rows = await store.recentTranscript(ctx.config.workspaceId, ctx.sessionKey, CALL_HISTORY_ROWS);
    } catch {
      rows = null;
    }
    for (const r of rows ?? []) {
      try {
        turns.push({ role: r.role, content: ctx.deps.decrypt(r.engagement_id, r.cipher_b64) });
      } catch {
        // Undecryptable row: skip it.
      }
    }
  }
  const heard = ctx.inbound.voice?.interruptedAgentText?.trim();
  if (heard) {
    const marked = `${heard} [the caller interrupted here]`;
    const last = turns[turns.length - 1];
    if (last?.role === "user") {
      // The caller cut in before the agent's answer was stored (only their line was kept):
      // what they heard is the agent's reply to that line.
      turns = [...turns, { role: "assistant", content: marked }];
    } else {
      // The answer was stored in full but only part of it was played.
      const idx = turns.map((t) => t.role).lastIndexOf("assistant");
      if (idx >= 0) turns = turns.map((t, i) => (i === idx ? { ...t, content: marked } : t));
    }
  }
  return turns;
}

async function webHistory(ctx: TurnContext, sessionId: string, trust: SessionTrust): Promise<HistoryTurn[]> {
  const clientUserTurns = (ctx.inbound.clientHistory ?? [])
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  const fallback = (source: "new" | "client_only" = "client_only"): HistoryTurn[] => {
    ctx.historySource = source;
    return clientUserTurns.slice(-FALLBACK_USER_TURNS).map((content) => ({ role: "user", content }));
  };

  // A bad / expired / other-slug session token: brand-new server-issued
  // session, so no stored transcript is used.
  if (trust === "fresh") return fallback();

  const { store } = ctx.deps;
  if (!store || !ctx.deps.encryptionAvailable()) return fallback();
  let rows: Awaited<ReturnType<typeof store.recentTranscript>>;
  try {
    rows = await store.recentTranscript(ctx.config.workspaceId, sessionId, WEB_HISTORY_ROWS);
  } catch {
    rows = null;
  }
  if (!rows) return fallback();
  // Nothing stored for this session yet (first message).
  if (rows.length === 0) return fallback("new");

  const server: HistoryTurn[] = [];
  for (const r of rows) {
    try {
      server.push({ role: r.role, content: ctx.deps.decrypt(r.engagement_id, r.cipher_b64) });
    } catch {
      // Undecryptable row (rotated key, corrupt): skip it, keep the rest.
    }
  }
  if (server.length === 0) return fallback();

  // A valid session token proves the server issued this sessionId to this
  // widget: its transcript is trusted as is. Without one, the transcript must
  // be anchored in what the client holds.
  const lastServerUser = [...server].reverse().find((t) => t.role === "user");
  if (trust !== "verified" && lastServerUser && !clientUserTurns.includes(lastServerUser.content)) {
    console.warn(`[agent-runtime] ${ctx.config.slug}: transcript not anchored in client history; using client user turns only`);
    return fallback();
  }
  ctx.historySource = "server";
  return server;
}

async function smsHistory(ctx: TurnContext): Promise<HistoryTurn[]> {
  const conv = ctx.inbound.conv;
  const store = ctx.deps.store;
  if (conv.kind !== "contact" || !store) return [];
  let rows = await store.smsHistory({
    workspaceId: ctx.config.workspaceId,
    contactId: conv.contactId,
    excludeId: ctx.claimedId,
    limit: SMS_HISTORY_ROWS + 1,
  });
  if (!ctx.claimedId) {
    // Claim row id unknown (insert failed): drop the newest inbound if it is this message.
    const current = redactHighRisk(ctx.deps.sanitize, ctx.inbound.text);
    if (rows[0]?.direction === "inbound" && rows[0].body === current) rows = rows.slice(1);
  }
  return rows
    .slice(0, SMS_HISTORY_ROWS)
    .reverse()
    .filter((r) => !!r.body && r.status !== "failed")
    .map((r) =>
      r.direction === "inbound"
        ? { role: "user" as const, content: redactHighRisk(ctx.deps.sanitize, r.body ?? "") }
        : { role: "assistant" as const, content: r.body ?? "" },
    );
}

/**
 * History + the current message as Anthropic messages: consecutive turns of
 * the same role are merged and the list always starts with the user.
 */
export function buildMessages(history: HistoryTurn[], current: string): Anthropic.Messages.MessageParam[] {
  const merged: HistoryTurn[] = [];
  for (const t of [...history, { role: "user" as const, content: current }]) {
    if (!t.content) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.content = `${last.content}\n\n${t.content}`;
    else if (merged.length > 0 || t.role === "user") merged.push({ ...t });
  }
  return merged.map((t) => ({ role: t.role, content: t.content }));
}
