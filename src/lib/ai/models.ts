/**
 * Single source of truth for which Claude model each runtime role uses.
 *
 * Values are the ones production already runs with; this module only
 * centralizes them so a model change is one edit instead of five. The env
 * overrides are the same ones the call sites honored before:
 *   - ANTHROPIC_MODEL       → web chat + classifiers (Haiku by default)
 *   - ANTHROPIC_DRAFT_MODEL → SMS front-desk drafting loop (Sonnet by default)
 *
 * Read at call time (not cached) so tests can stub env per case; callers that
 * want a module-level constant can still capture `modelFor(...)` once.
 */

export type ModelRole =
  /** Customer-facing web chat (landing + multi-tenant widget). */
  | "chat"
  /** Structured single-shot classifiers (DLP Layer 2, intent, injection). */
  | "classifier"
  /** SMS front-desk tool loop (booking/reschedule/cancel). */
  | "sms_agent";

export const DEFAULT_MODELS: Readonly<Record<ModelRole, string>> = {
  chat: "claude-haiku-4-5-20251001",
  classifier: "claude-haiku-4-5-20251001",
  sms_agent: "claude-sonnet-4-6",
};

export function modelFor(role: ModelRole): string {
  switch (role) {
    case "chat":
    case "classifier":
      return process.env.ANTHROPIC_MODEL ?? DEFAULT_MODELS[role];
    case "sms_agent":
      return process.env.ANTHROPIC_DRAFT_MODEL ?? DEFAULT_MODELS.sms_agent;
  }
}
