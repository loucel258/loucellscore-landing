"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Shield, Send, RotateCcw, FileCheck } from "lucide-react";
import type { SanitizeResult } from "@/lib/dlp/sanitizer";

type RecordState =
  | { status: "idle" }
  | { status: "recording" }
  | { status: "ok"; requestId: string }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

const SAMPLE_PROMPTS = [
  {
    label: "Sales lead with PII",
    text: `Hi team, follow up with Maria Hernandez at maria.hernandez@acmelogistics.com or (305) 555-0193. Her SSN on file is 234-56-7890, business EIN 47-1234567. She's interested in the AI Front Desk and her card 4242 4242 4242 4242 expires next month.`,
  },
  {
    label: "Developer leaking a secret",
    text: `Quick question — I'm hitting the Claude API with sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz123456 but getting 401. Also my AWS key is AKIAIOSFODNN7EXAMPLE in case that matters.`,
  },
  {
    label: "Compliance scenario",
    text: `Customer Diana Lopez (ITIN 912-78-1234, phone +1 561-555-2078) wants to dispute charges on her credit card 5500 0000 0000 0004. Send the file to diana.lopez@example.com when ready.`,
  },
  {
    label: "Partial / non-standard format (Layer 1.5)",
    text: `Cliente: Javier Ruiz. Su seguro social es 234 56 789 (le faltó un dígito al teclear). El EIN del negocio es 47 1234567 sin guiones. Phone number 786 555 0102. Credit card number 4532 1488 0343 6467. Send confirmation.`,
  },
  {
    label: "Bilingual labels (Spanish keywords)",
    text: `Hola, necesito actualizar el perfil de la Sra. Hernández. Su número del seguro social es 312-45-6789, su número de tarjeta es 5500 0000 0000 0004, y su teléfono celular es 305-555-0193. Tax ID personal 912-77-1234.`,
  },
  {
    label: "Spelled-out PII (needs Layer 2)",
    text: `El cliente me dictó su social: dos tres cuatro guion cinco seis guion siete ocho nueve cero. Su passport es A B uno dos tres cuatro cinco seis siete. Date of birth March fifteen nineteen eighty five. La cuenta bancaria es cuatro mil uno cero cero cero dos cero cero. Forward this to records.`,
  },
  {
    label: "Clean prompt (control)",
    text: `Schedule a discovery call about deploying an AI Front Desk for a construction company in Broward County. They serve about 40 leads per week, mostly bilingual customers.`,
  },
];

const EMPTY_RESULT: SanitizeResult = {
  original: "",
  sanitized: "",
  redactions: [],
  stats: {
    totalRedactions: 0,
    byType: {},
    bySource: { regex: 0, context: 0, llm: 0 },
    charsTotal: 0,
    charsRedacted: 0,
  },
  layer2Used: false,
  layer2Available: false,
};

type MintedToken = { token: string; expiresAt: number };

/** Mint a short-lived demo workspace JWT. null when the auth endpoint fails. */
async function mintDemoToken(): Promise<MintedToken | null> {
  try {
    const res = await fetch("/api/demo/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspace_id: "ws_demo_001",
        role_label: "front_desk_agent",
      }),
    });
    if (!res.ok) return null;
    const { token, ttl_seconds } = (await res.json()) as {
      token: string;
      ttl_seconds: number;
    };
    return { token, expiresAt: Date.now() + ttl_seconds * 1000 };
  } catch {
    return null;
  }
}

export function DLPDemo() {
  const [input, setInput] = useState(SAMPLE_PROMPTS[0].text);
  const [result, setResult] = useState<SanitizeResult>(EMPTY_RESULT);
  // The first sample is previewed on mount, so start in the previewing state.
  const [previewing, setPreviewing] = useState(() => SAMPLE_PROMPTS[0].text !== "");
  const [layer2, setLayer2] = useState(false);
  // Workspace JWT, minted once per session. TTL is 5 min server-side; if a
  // demo session runs longer we re-mint on demand.
  const [token, setToken] = useState<string | null>(null);
  const tokenExpiresAtRef = useRef<number>(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mint or refresh the demo JWT before any call that needs it. The DLP
  // routes now require a workspace JWT, so the preview AND the record path
  // both depend on this. We mint with role_label='front_desk_agent' since
  // DLP is most often invoked on the inbound (front-desk) path.
  const storeToken = useCallback((minted: MintedToken): string => {
    tokenExpiresAtRef.current = minted.expiresAt;
    setToken(minted.token);
    return minted.token;
  }, []);

  const ensureToken = useCallback(async (): Promise<string | null> => {
    if (token && tokenExpiresAtRef.current > Date.now() + 30_000) {
      return token; // still valid for at least 30 more seconds
    }
    const minted = await mintDemoToken();
    return minted ? storeToken(minted) : null;
  }, [token, storeToken]);

  // Mint token on mount so the first keystroke isn't delayed by an auth call.
  useEffect(() => {
    void mintDemoToken().then((minted) => {
      if (minted) storeToken(minted);
    });
  }, [storeToken]);

  // Input and layer changes start the preview right away (the request
  // itself is debounced below). An empty prompt clears the result.
  function changeInput(next: string) {
    if (next === input) return;
    setInput(next);
    if (!next) setResult(EMPTY_RESULT);
    else setPreviewing(true);
  }

  function changeLayer2(next: boolean) {
    setLayer2(next);
    if (input) setPreviewing(true);
  }

  // Debounced server-side sanitization. Both layers run server-side; the
  // browser never sees the canonical regex output. JWT is required and
  // minted lazily — if the token call is in flight when the first keystroke
  // arrives, the preview just defers one tick.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!input) return;
    const delay = layer2 ? 600 : 250; // give the LLM more breathing room
    debounceRef.current = setTimeout(async () => {
      try {
        const t = await ensureToken();
        if (!t) {
          setPreviewing(false);
          return;
        }
        const res = await fetch("/api/demo/dlp/preview", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${t}`,
          },
          body: JSON.stringify({ prompt: input, layer2 }),
        });
        if (res.ok) {
          const json = (await res.json()) as SanitizeResult;
          setResult(json);
        }
      } finally {
        setPreviewing(false);
      }
    }, delay);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, layer2, ensureToken]);

  const hasRedactions = result.stats.totalRedactions > 0;
  const [recordState, setRecordState] = useState<RecordState>({ status: "idle" });

  async function recordToAuditLog() {
    setRecordState({ status: "recording" });
    try {
      const t = await ensureToken();
      if (!t) {
        setRecordState({
          status: "error",
          error: "Could not mint workspace JWT. Auth endpoint unreachable.",
        });
        return;
      }
      const res = await fetch("/api/demo/dlp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({ prompt: input, layer2 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRecordState({
          status: "error",
          error: json?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const audit = json.audit as
        | { ok: true; id: string }
        | { ok: false; reason: string; error?: string };
      if (audit?.ok) {
        setRecordState({ status: "ok", requestId: json.request_id });
      } else {
        setRecordState({
          status: "skipped",
          reason:
            audit?.reason === "not_configured"
              ? "Supabase not configured. Set env vars to persist."
              : `Insert failed: ${audit?.error ?? "unknown"}`,
        });
      }
    } catch (err) {
      setRecordState({
        status: "error",
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  return (
    <div className="container-page py-12 md:py-16">
      {/* Header */}
      <div className="flex flex-col gap-6 border-b border-border-soft pb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-mono-xs text-text-tertiary transition-colors hover:text-text-secondary"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.5} />
          Back to Loucells Core
        </Link>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="text-micro text-cyan">
              {"//"} TRUST STACK · DEMO 01
            </span>
            <span className="text-mono-xs text-text-tertiary">
              DLP MIDDLEWARE
            </span>
          </div>
          <h1 className="text-display-2 max-w-3xl text-balance text-text-primary">
            PII and secrets stripped before the prompt touches the model.
          </h1>
          <p className="max-w-2xl text-body text-text-secondary">
            This is the first checkpoint of the Loucells Core Trust Stack.
            Every prompt heading to Claude passes through a strict regex +
            Luhn validation layer that detects social security numbers, tax
            IDs, credit cards, API keys, emails, and phone numbers — and
            replaces them with audit-friendly tokens before the language
            model ever sees them.
          </p>
        </div>
      </div>

      {/* Layer 2 toggle */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border-soft bg-surface/40 p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <span className="text-mono-xs text-text-tertiary">DETECTION DEPTH</span>
          <span className="text-body-sm text-text-primary">
            {layer2
              ? "Layer 1 (regex) + Layer 1.5 (bilingual context) + Layer 2 (Claude Haiku)"
              : "Layer 1 (regex) + Layer 1.5 (bilingual context). Layer 2 off."}
          </span>
          {layer2 && (
            <span className="text-mono-xs text-text-tertiary">
              Layer 2 status:{" "}
              {result.layer2Available ? (
                <span className="text-cyan">✓ available · classifier responded</span>
              ) : result.layer2Used ? (
                <span className="text-violet">✗ unavailable · using Layer 1 only</span>
              ) : (
                <span className="text-text-tertiary">awaiting first call</span>
              )}
            </span>
          )}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={layer2}
            onChange={(e) => changeLayer2(e.target.checked)}
            className="size-4 accent-cyan"
          />
          <span className="text-mono-xs text-cyan">Enable Layer 2</span>
        </label>
      </div>

      {/* Sample prompts */}
      <div className="mt-8 flex flex-col gap-3">
        <span className="text-mono-xs text-text-tertiary">SAMPLE PROMPTS</span>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
          {SAMPLE_PROMPTS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => changeInput(p.text)}
              className="group flex items-start gap-3 rounded-lg border border-border-soft bg-surface/60 p-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan/40 hover:bg-surface-2"
            >
              <Send
                className="mt-0.5 size-3.5 shrink-0 text-text-tertiary transition-colors group-hover:text-cyan"
                strokeWidth={1.5}
              />
              <span className="text-body-sm text-text-primary">{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Two-pane console */}
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        {/* LEFT — raw input */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-mono-xs text-text-tertiary">
              01 · RAW PROMPT (what the user types)
            </span>
            <button
              type="button"
              onClick={() => changeInput("")}
              className="inline-flex items-center gap-1.5 text-mono-xs text-text-tertiary transition-colors hover:text-cyan"
            >
              <RotateCcw className="size-3" strokeWidth={1.5} />
              Clear
            </button>
          </div>
          <div className="relative rounded-xl border border-border-soft bg-surface/50">
            <textarea
              value={input}
              onChange={(e) => changeInput(e.target.value)}
              className="block min-h-[280px] w-full resize-y rounded-xl bg-transparent p-5 font-mono text-[13px] leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary focus:ring-1 focus:ring-cyan/40"
              placeholder="Paste a prompt with PII, secrets, or sensitive identifiers..."
              spellCheck={false}
            />
            {hasRedactions && (
              <HighlightOverlay original={input} result={result} />
            )}
          </div>
          <span className="text-mono-xs text-text-tertiary">
            {result.stats.charsTotal} chars
          </span>
        </div>

        {/* RIGHT — sanitized output */}
        <div className="flex flex-col gap-2">
          <span className="text-mono-xs text-cyan">
            02 · SANITIZED → SENT TO CLAUDE
            {previewing && (
              <span className="ml-2 animate-pulse text-text-tertiary">
                · sanitizing server-side...
              </span>
            )}
          </span>
          <div className="relative min-h-[280px] rounded-xl border border-cyan/40 bg-surface-2 p-5">
            <SanitizedView sanitized={result.sanitized} />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-xl"
              style={{
                boxShadow:
                  "0 0 24px -8px color-mix(in oklab, var(--accent-cyan) 30%, transparent)",
              }}
            />
          </div>
          <span className="text-mono-xs text-text-tertiary">
            {result.sanitized.length} chars · {result.stats.totalRedactions}{" "}
            redactions
          </span>
        </div>
      </div>

      {/* Record to audit log */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={recordToAuditLog}
          disabled={recordState.status === "recording"}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-cyan/40 bg-cyan/10 px-4 text-mono-xs font-semibold text-cyan transition-colors hover:bg-cyan/20 disabled:opacity-50"
        >
          <FileCheck className="size-3.5" strokeWidth={1.5} />
          {recordState.status === "recording"
            ? "Recording..."
            : "Record to Audit Log"}
        </button>
        {recordState.status === "ok" && (
          <span className="text-mono-xs text-cyan">
            ✓ Recorded · request_id {recordState.requestId}
          </span>
        )}
        {recordState.status === "skipped" && (
          <span className="text-mono-xs text-text-tertiary">
            {recordState.reason}
          </span>
        )}
        {recordState.status === "error" && (
          <span className="text-mono-xs text-violet">
            ✗ {recordState.error}
          </span>
        )}
      </div>

      {/* Stats panel */}
      <div className="mt-6 rounded-xl border border-border-soft bg-surface/60 p-6 md:p-8">
        <div className="flex items-center gap-3">
          <Shield className="size-4 text-cyan" strokeWidth={1.5} />
          <span className="text-mono-xs text-cyan">
            03 · SANITIZATION REPORT
          </span>
        </div>

        {!hasRedactions ? (
          <p className="mt-5 max-w-2xl text-body text-text-secondary">
            No PII or secrets detected. The prompt passes through unchanged.
            This is the expected outcome for a clean operational query.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="text-mono-xs text-text-tertiary">
                TOTAL REDACTIONS
              </span>
              <span className="text-display-2 tabular-nums text-text-primary">
                {result.stats.totalRedactions}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-mono-xs text-text-tertiary">
                CHARS PROTECTED
              </span>
              <span className="text-display-2 tabular-nums text-text-primary">
                {result.stats.charsRedacted}
              </span>
              <span className="text-mono-xs text-text-tertiary">
                of {result.stats.charsTotal} (
                {(
                  (result.stats.charsRedacted / result.stats.charsTotal) *
                  100
                ).toFixed(1)}
                %)
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-mono-xs text-text-tertiary">BY TYPE</span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(result.stats.byType).map(([type, count]) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1.5 rounded-md border border-violet/40 bg-violet/10 px-2 py-1 text-mono-xs text-violet"
                  >
                    {type} × {count}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {hasRedactions && (
          <div className="mt-8 border-t border-border-soft pt-6">
            <span className="text-mono-xs text-text-tertiary">
              REDACTION LOG (what the audit trail would record)
            </span>
            <div className="mt-3 overflow-x-auto rounded-lg border border-border-soft">
              <table className="w-full text-left text-body-sm">
                <thead className="border-b border-border-soft bg-surface-2/60">
                  <tr className="text-mono-xs uppercase text-text-tertiary">
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Source</th>
                    <th className="px-4 py-2.5">Confidence</th>
                    <th className="px-4 py-2.5">Position</th>
                    <th className="px-4 py-2.5">Replacement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {result.redactions.map((r, i) => (
                    <tr key={i} className="font-mono text-[12px]">
                      <td className="px-4 py-2 text-cyan">{r.type}</td>
                      <td className="px-4 py-2">
                        <SourceBadge source={r.source} />
                      </td>
                      <td className="px-4 py-2 text-text-tertiary tabular-nums">
                        {r.confidence}
                      </td>
                      <td className="px-4 py-2 text-text-tertiary tabular-nums">
                        {r.start}–{r.end}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        {r.replacement}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Production architecture callout */}
      <div className="mt-10 rounded-xl border border-border-soft bg-surface/40 p-6 md:p-8">
        <span className="text-mono-xs text-text-tertiary">
          PRODUCTION ARCHITECTURE
        </span>
        <p className="mt-3 max-w-3xl text-body text-text-secondary">
          What you see here is the deterministic regex + Luhn layer. In a real
          deployment it sits behind a fast classification model that catches
          the patterns regex never could.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <ArchNote
            title="Layer 1 — Strict regex (this demo)"
            body="Exact-format patterns: SSN with valid SSA ranges, ITIN middle-group rules, Luhn-validated cards, vendor API key prefixes. Sub-millisecond. Catches well-formed identifiers cheaply before anything heavier runs."
          />
          <ArchNote
            title="Layer 1.5 — Bilingual context (this demo)"
            body="Catches partial/non-standard PII when a sensitive keyword is nearby. Recognizes English AND Spanish labels (seguro social, número de tarjeta, etc.). Closes the gap where a typo or different separator otherwise leaks data."
          />
          <ArchNote
            title="Layer 2 — Production add-on"
            body="Microsoft Presidio (NER for names, addresses, organizations) plus a classifier (Llama Guard / Claude moderation) for context-aware and spelled-out detection. Returns sanitized prompt OR a 403 with classifier reason."
          />
          <ArchNote
            title="Layer 3 — Persistence + observability"
            body="Every sanitization writes one append-only row to audit_logs (SHA-256 hash, never raw). Hash chain detects tampering. Daily drift report on redaction-by-type — part of the monthly governance retainer."
          />
        </div>
        <p className="mt-5 text-body-sm text-text-tertiary">
          <strong className="text-text-secondary">Residual gaps (Layer 2 required):</strong>{" "}
          numbers spelled out as words (&quot;uno dos tres&quot;), OCR-corrupted text from
          uploaded images, audio-to-text transcriptions where digits arrive
          as words, and bare digit strings with no surrounding context. These
          are documented and routed to the Layer 2 classifier in production.
        </p>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: "regex" | "context" | "llm" }) {
  const map = {
    regex: { label: "L1 · regex", cls: "border-cyan/40 bg-cyan/10 text-cyan" },
    context: {
      label: "L1.5 · context",
      cls: "border-violet/40 bg-violet/10 text-violet",
    },
    llm: {
      label: "L2 · Claude",
      cls: "border-cyan/60 bg-cyan/15 text-cyan font-semibold",
    },
  } as const;
  const { label, cls } = map[source];
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-mono-xs ${cls}`}
    >
      {label}
    </span>
  );
}

function ArchNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border-soft bg-surface/60 p-4">
      <span className="text-mono-xs text-cyan">{title}</span>
      <p className="text-body-sm text-text-secondary">{body}</p>
    </div>
  );
}

function HighlightOverlay({
  original,
  result,
}: {
  original: string;
  result: SanitizeResult;
}) {
  // Build segments: alternating between plain text and highlighted redactions.
  const segments: Array<
    | { kind: "text"; text: string }
    | { kind: "redaction"; text: string; type: string }
  > = [];
  let cursor = 0;
  const sorted = [...result.redactions].sort((a, b) => a.start - b.start);
  for (const r of sorted) {
    if (r.start > cursor) {
      segments.push({ kind: "text", text: original.slice(cursor, r.start) });
    }
    segments.push({
      kind: "redaction",
      text: original.slice(r.start, r.end),
      type: r.type,
    });
    cursor = r.end;
  }
  if (cursor < original.length) {
    segments.push({ kind: "text", text: original.slice(cursor) });
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl p-5 font-mono text-[13px] leading-relaxed"
      style={{ color: "transparent" }}
    >
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span
            key={i}
            style={{
              background:
                "color-mix(in oklab, var(--accent-violet) 30%, transparent)",
              borderRadius: 3,
              padding: "0 2px",
              color: "transparent",
            }}
          >
            {s.text}
          </span>
        ),
      )}
    </div>
  );
}

function SanitizedView({ sanitized }: { sanitized: string }) {
  // Re-emphasize redaction tokens in cyan so they're visually distinct.
  const tokenRegex = /\[REDACTED_[A-Z_]+\]/g;
  const parts: Array<{ text: string; isToken: boolean }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(sanitized)) !== null) {
    if (m.index > last) {
      parts.push({ text: sanitized.slice(last, m.index), isToken: false });
    }
    parts.push({ text: m[0], isToken: true });
    last = m.index + m[0].length;
  }
  if (last < sanitized.length) {
    parts.push({ text: sanitized.slice(last), isToken: false });
  }
  return (
    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-text-primary">
      {parts.length === 0 ? (
        <span className="text-text-tertiary">
          Waiting for input...
        </span>
      ) : (
        parts.map((p, i) =>
          p.isToken ? (
            <span
              key={i}
              className="rounded-sm bg-cyan/15 px-1 font-semibold text-cyan"
            >
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )
      )}
    </pre>
  );
}
