/**
 * Agent config versions (migration 070): a signed, append-only history of
 * what an agent was configured to say and do.
 *
 * This module is pure (no I/O, safe for client components): snapshots, the
 * diff between two of them, a line diff for the persona, and the mapping
 * from a snapshot back to an update-route payload. The database side is in
 * config-versions-db.ts.
 *
 * A snapshot holds the fields that change what the agent does: persona,
 * greeting, tools, origins, display name, max tokens and the integrations
 * jsonb with anything secret-looking stripped. Slug, status, billing and
 * brand color are not behavior and are not versioned.
 */

export const SNAPSHOT_VERSION = 1;

export type ConfigSnapshot = {
  v: number;
  name: string;
  system_prompt: string | null;
  greeting_message: string | null;
  tools_enabled: string[];
  allowed_origins: string[];
  max_tokens_per_message: number | null;
  integrations: Record<string, unknown>;
};

/** The client_agents columns a snapshot is built from. */
export type SnapshotSource = {
  name?: string | null;
  system_prompt?: string | null;
  greeting_message?: string | null;
  tools_enabled?: string[] | null;
  allowed_origins?: string[] | null;
  max_tokens_per_message?: number | null;
  integrations?: unknown;
};

export type ConfigVersionRow = {
  id: string;
  created_at: string;
  agent_id: string;
  workspace_id: string;
  version: number;
  snapshot: ConfigSnapshot;
  changed_fields: string[];
  approved_by: string;
  note: string | null;
};

const SECRET_KEY = /(secret|token|password|passcode|api[_-]?key|private[_-]?key|credential|authorization)/i;

/** Deep copy of a jsonb value without any key that looks like a secret. */
export function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = scrubSecrets(v);
    }
    return out;
  }
  return value;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function snapshotFromRow(row: SnapshotSource): ConfigSnapshot {
  return {
    v: SNAPSHOT_VERSION,
    name: row.name ?? "",
    system_prompt: row.system_prompt || null,
    greeting_message: row.greeting_message || null,
    tools_enabled: [...(row.tools_enabled ?? [])].sort(),
    allowed_origins: [...(row.allowed_origins ?? [])].sort(),
    max_tokens_per_message: row.max_tokens_per_message ?? null,
    integrations: scrubSecrets(asRecord(row.integrations)) as Record<string, unknown>,
  };
}

/** Parse a stored snapshot defensively (the column is jsonb). */
export function parseSnapshot(raw: unknown): ConfigSnapshot | null {
  const o = asRecord(raw);
  if (typeof o.name !== "string" && !("system_prompt" in o)) return null;
  const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    v: typeof o.v === "number" ? o.v : SNAPSHOT_VERSION,
    name: typeof o.name === "string" ? o.name : "",
    system_prompt: strOrNull(o.system_prompt),
    greeting_message: strOrNull(o.greeting_message),
    tools_enabled: strs(o.tools_enabled).sort(),
    allowed_origins: strs(o.allowed_origins).sort(),
    max_tokens_per_message: typeof o.max_tokens_per_message === "number" ? o.max_tokens_per_message : null,
    integrations: asRecord(o.integrations),
  };
}

// ── Diff ───────────────────────────────────────────────────────────────────

export type FieldDiff = { field: string; before: unknown; after: unknown };

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** JSON with sorted object keys, so key order never reads as a change. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}

/**
 * Every field that differs, in a stable order. Integrations are compared one
 * level down ("integrations.booking.business_hours") so the list says WHAT
 * moved, not just "integrations".
 */
export function diffSnapshots(before: ConfigSnapshot, after: ConfigSnapshot): FieldDiff[] {
  const out: FieldDiff[] = [];
  const flat: Array<keyof ConfigSnapshot> = [
    "name",
    "system_prompt",
    "greeting_message",
    "tools_enabled",
    "allowed_origins",
    "max_tokens_per_message",
  ];
  for (const f of flat) {
    if (!same(before[f], after[f])) out.push({ field: f, before: before[f], after: after[f] });
  }
  const b = before.integrations;
  const a = after.integrations;
  const topKeys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  for (const top of topKeys) {
    const bv = b[top];
    const av = a[top];
    if (same(bv, av)) continue;
    const bo = bv && typeof bv === "object" && !Array.isArray(bv);
    const ao = av && typeof av === "object" && !Array.isArray(av);
    if ((bo || bv === undefined) && (ao || av === undefined) && (bo || ao)) {
      const bs = asRecord(bv);
      const as = asRecord(av);
      for (const sub of [...new Set([...Object.keys(bs), ...Object.keys(as)])].sort()) {
        if (!same(bs[sub], as[sub])) out.push({ field: `integrations.${top}.${sub}`, before: bs[sub], after: as[sub] });
      }
    } else {
      out.push({ field: `integrations.${top}`, before: bv, after: av });
    }
  }
  return out;
}

/** Short printable form of a field value for the before / after view. */
export function displayValue(v: unknown): string {
  if (v === undefined || v === null) return "(not set)";
  if (typeof v === "string") return v === "" ? "(empty)" : v;
  if (Array.isArray(v) && v.length === 0) return "(none)";
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.join(", ");
  return stableJson(v);
}

export type LineDiffOp = { type: "same" | "add" | "del"; text: string };

/** Line by line diff (longest common subsequence). `a` = before, `b` = after. */
export function lineDiff(a: string, b: string): LineDiffOp[] {
  const x = a === "" ? [] : a.split("\n");
  const y = b === "" ? [] : b.split("\n");
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: LineDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ type: "same", text: x[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: "del", text: x[i++]! });
    } else {
      out.push({ type: "add", text: y[j++]! });
    }
  }
  while (i < n) out.push({ type: "del", text: x[i++]! });
  while (j < m) out.push({ type: "add", text: y[j++]! });
  return out;
}

// ── Restore ────────────────────────────────────────────────────────────────

/** integrations keys the update route can write (everything else is shown in the diff, never restored). */
export const RESTORABLE_INTEGRATIONS = ["calendar", "reminders", "locale", "booking", "voice", "owner_alerts"] as const;

/** Phone settings a restore may put back. Never the Vapi secret (snapshots don't hold it). */
const RESTORABLE_VOICE = [
  "enabled",
  "provider",
  "voice_en",
  "voice_es",
  "default_lang",
  "transfer_number",
  "recording_notice",
  "max_call_minutes",
];

const pick = (o: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * The update-route payload that puts an agent back to a snapshot. It is fed
 * through the route's own schema, so every validation, the slug lock and the
 * readiness rules apply exactly as for a manual edit.
 */
export function restoreInputFromSnapshot(s: ConfigSnapshot): Record<string, unknown> {
  const integ = s.integrations;
  const calendar = asRecord(integ.calendar);
  const reminders = asRecord(integ.reminders);
  const booking = asRecord(integ.booking);
  const integrations: Record<string, unknown> = {
    booking: {
      link_url: typeof booking.link_url === "string" ? booking.link_url : "",
      business_hours: booking.business_hours ?? null,
      timezone: typeof booking.timezone === "string" ? booking.timezone : null,
    },
  };
  if (Object.keys(calendar).length > 0) integrations.calendar = pick(calendar, ["provider", "calendar_id", "timezone"]);
  if (Object.keys(reminders).length > 0) {
    integrations.reminders = pick(reminders, ["enabled", "lead_hours", "channel", "from_number"]);
  }
  if (integ.locale === "en" || integ.locale === "es") integrations.locale = integ.locale;
  // Turning voice back on still goes through the route's checks (credentials, Vapi secret).
  const voice = Object.fromEntries(
    Object.entries(pick(asRecord(integ.voice), RESTORABLE_VOICE)).filter(([, v]) => v !== null),
  );
  if (Object.keys(voice).length > 0) integrations.voice = voice;
  const alerts = asRecord(integ.owner_alerts);
  if (Object.keys(alerts).length > 0) {
    integrations.owner_alerts = {
      enabled: alerts.enabled === true,
      emails: Array.isArray(alerts.emails) ? alerts.emails.filter((e): e is string => typeof e === "string") : [],
    };
  }

  return {
    name: s.name || undefined,
    systemPrompt: s.system_prompt,
    greetingMessage: s.greeting_message,
    toolsEnabled: s.tools_enabled,
    allowedOrigins: s.allowed_origins,
    ...(s.max_tokens_per_message ? { maxTokensPerMessage: s.max_tokens_per_message } : {}),
    integrations,
  };
}

/** Admin-readable name for a changed field. */
export function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    name: "Display name",
    system_prompt: "Persona",
    greeting_message: "Greeting",
    tools_enabled: "Tools",
    allowed_origins: "Allowed origins",
    max_tokens_per_message: "Max tokens per reply",
  };
  return labels[field] ?? field.replace(/^integrations\./, "").replace(/\./g, " / ").replace(/_/g, " ");
}
