/**
 * Chronological order for stored conversation turns.
 *
 * persistTurn used to insert a turn's user row and assistant row in one
 * statement, so both got the same now() and the database returned them in
 * either order: the inbox could show the reply above the question, and the
 * agent's server-side history could feed the model a reply before the
 * question that prompted it. New rows are written 1 ms apart; this
 * comparator fixes the rows already stored: on a timestamp tie the
 * customer's message comes first.
 */

const RANK: Record<string, number> = { user: 0, tool: 1, system_event: 1, assistant: 2 };

export function byTurnOrder(
  a: { inserted_at: string; role: string },
  b: { inserted_at: string; role: string },
): number {
  const ta = Date.parse(a.inserted_at);
  const tb = Date.parse(b.inserted_at);
  if (ta !== tb) return ta - tb;
  return (RANK[a.role] ?? 1) - (RANK[b.role] ?? 1);
}
