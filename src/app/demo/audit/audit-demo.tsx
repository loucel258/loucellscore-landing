"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  AlertTriangle,
  Database,
  Lock,
} from "lucide-react";
import type { AuditEntryRow } from "@/lib/audit/types";

type ReadResponse =
  | { ok: true; rows: AuditEntryRow[] }
  | { ok: false; reason: "not_configured" | "query_failed"; error?: string };

type AttemptResponse = {
  ok: boolean;
  blocked?: boolean;
  configured?: boolean;
  empty?: boolean;
  op?: string;
  targetId?: string;
  triggerError?: { code?: string; message: string } | null;
  message: string;
};

/** Read the masked audit log. Never rejects: a failure comes back as query_failed. */
async function fetchAuditLog(): Promise<ReadResponse> {
  try {
    const res = await fetch("/api/demo/audit", { cache: "no-store" });
    return (await res.json()) as ReadResponse;
  } catch (err) {
    return {
      ok: false,
      reason: "query_failed",
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

export function AuditDemo() {
  const [data, setData] = useState<ReadResponse | null>(null);
  // The first fetch starts on mount, so the log begins in the loading state.
  const [loading, setLoading] = useState(true);
  const [attemptResult, setAttemptResult] = useState<AttemptResponse | null>(
    null,
  );
  const [attemptInFlight, setAttemptInFlight] = useState<string | null>(null);

  // Store a settled fetch. Only ever called from a promise callback, so the
  // mount effect below never sets state synchronously.
  const receive = useCallback((json: ReadResponse) => {
    setData(json);
    setLoading(false);
  }, []);

  // Refresh button: show the spinner, then fetch.
  const load = useCallback(() => {
    setLoading(true);
    void fetchAuditLog().then(receive);
  }, [receive]);

  useEffect(() => {
    void fetchAuditLog().then(receive);
  }, [receive]);

  const runAttempt = useCallback(async (op: "update" | "delete") => {
    setAttemptInFlight(op);
    setAttemptResult(null);
    try {
      const res = await fetch("/api/demo/audit/attempt-modify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op }),
      });
      const json = (await res.json()) as AttemptResponse;
      setAttemptResult(json);
    } catch (err) {
      setAttemptResult({
        ok: false,
        message: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setAttemptInFlight(null);
    }
  }, []);

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
              {"//"} TRUST STACK · DEMO 03
            </span>
            <span className="text-mono-xs text-text-tertiary">
              IMMUTABLE AUDIT TRAIL
            </span>
          </div>
          <h1 className="text-display-2 max-w-3xl text-balance text-text-primary">
            Every agent decision recorded forever. Even we can&apos;t rewrite it.
          </h1>
          <p className="max-w-2xl text-body text-text-secondary">
            Each request through the DLP and RBAC layers writes one row to an
            append-only Postgres table in Supabase. UPDATE and DELETE are
            blocked at the trigger level — not by application code, by the
            database itself. The PoC below tries to delete a row using our own
            service-role key and shows you the exception.
          </p>
        </div>
      </div>

      {/* Status / config */}
      <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard
          icon={<Database className="size-4" strokeWidth={1.5} />}
          label="Storage"
          value="Supabase Postgres"
          sub="append-only triggers"
        />
        <StatCard
          icon={<Lock className="size-4" strokeWidth={1.5} />}
          label="Write path"
          value="service_role only"
          sub="never from client"
        />
        <StatCard
          icon={<ShieldCheck className="size-4" strokeWidth={1.5} />}
          label="Read path"
          value="masked demo view"
          sub="user_id obfuscated"
        />
      </div>

      {/* PoC: attempt to modify */}
      <div className="mt-8 rounded-xl border border-violet/40 bg-violet/[0.05] p-6 md:p-8">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-4 text-violet" strokeWidth={1.5} />
          <span className="text-mono-xs text-violet">
            FORENSIC PoC · attempt to tamper with the audit log
          </span>
        </div>
        <p className="mt-3 max-w-3xl text-body text-text-secondary">
          The two buttons below issue real UPDATE and DELETE statements
          against the audit_logs table using the service_role key. The
          database trigger should refuse both. If it doesn&apos;t, the
          migration was not applied correctly.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => runAttempt("update")}
            disabled={attemptInFlight !== null}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-violet/40 bg-violet/10 px-4 text-mono-xs font-semibold text-violet transition-colors hover:bg-violet/20 disabled:opacity-50"
          >
            {attemptInFlight === "update" ? "Attempting..." : "Try UPDATE"}
          </button>
          <button
            type="button"
            onClick={() => runAttempt("delete")}
            disabled={attemptInFlight !== null}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-violet/40 bg-violet/10 px-4 text-mono-xs font-semibold text-violet transition-colors hover:bg-violet/20 disabled:opacity-50"
          >
            {attemptInFlight === "delete" ? "Attempting..." : "Try DELETE"}
          </button>
        </div>

        {attemptResult && (
          <div
            className={`mt-5 rounded-lg border p-4 ${
              attemptResult.blocked
                ? "border-cyan/40 bg-cyan/5"
                : "border-violet/40 bg-violet/5"
            }`}
          >
            <div className="flex items-center gap-2">
              {attemptResult.blocked ? (
                <ShieldCheck
                  className="size-4 text-cyan"
                  strokeWidth={1.5}
                />
              ) : (
                <ShieldOff
                  className="size-4 text-violet"
                  strokeWidth={1.5}
                />
              )}
              <span
                className={`text-mono-xs font-semibold ${
                  attemptResult.blocked ? "text-cyan" : "text-violet"
                }`}
              >
                {attemptResult.blocked ? "BLOCKED BY TRIGGER" : "NOT BLOCKED"}
              </span>
            </div>
            <p className="mt-2 text-body-sm text-text-primary">
              {attemptResult.message}
            </p>
            {attemptResult.triggerError && (
              <pre className="mt-3 overflow-x-auto rounded-md border border-border-soft bg-bg p-3 font-mono text-[12px] text-text-secondary">
                {JSON.stringify(attemptResult.triggerError, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Log table */}
      <div className="mt-8 flex items-center justify-between">
        <span className="text-mono-xs text-text-tertiary">
          FORENSIC LOG · most recent 50 entries
        </span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-mono-xs text-text-tertiary transition-colors hover:text-cyan disabled:opacity-50"
        >
          <RefreshCw
            className={`size-3 ${loading ? "animate-spin" : ""}`}
            strokeWidth={1.5}
          />
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border-soft bg-surface/40">
        {data?.ok === false ? (
          <EmptyState reason={data.reason} error={data.error} />
        ) : data?.ok && data.rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-body text-text-secondary">
              The audit log is empty. Generate a few entries from{" "}
              <Link
                href="/demo/dlp"
                className="text-cyan underline-offset-4 hover:underline"
              >
                /demo/dlp
              </Link>{" "}
              or{" "}
              <Link
                href="/demo/rbac"
                className="text-cyan underline-offset-4 hover:underline"
              >
                /demo/rbac
              </Link>{" "}
              and refresh.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-body-sm">
            <thead className="border-b border-border-soft bg-surface-2/60">
              <tr className="text-mono-xs uppercase text-text-tertiary">
                <th className="px-4 py-3" title="Per-workspace monotonic sequence number">
                  #
                </th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Decision</th>
                <th className="px-4 py-3">Role · User (masked)</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Prompt hash</th>
                <th className="px-4 py-3" title="SHA-256 chain hash linking this row to the previous one in the workspace's audit chain">
                  Chain hash
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {data?.ok &&
                data.rows.map((r) => (
                  <tr key={r.id} className="font-mono text-[12px]">
                    <td className="px-4 py-2.5 text-text-tertiary tabular-nums">
                      {r.workspace_sequence ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-text-tertiary tabular-nums">
                      {new Date(r.inserted_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 uppercase text-text-secondary">
                      {r.source}
                    </td>
                    <td
                      className={`px-4 py-2.5 font-semibold ${
                        r.decision === "ALLOW" ? "text-cyan" : "text-violet"
                      }`}
                    >
                      {r.decision}
                      {r.blocked_by && (
                        <span className="ml-2 text-text-tertiary">
                          · {r.blocked_by}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary">
                      {r.role}
                      <span className="ml-2 text-text-tertiary">
                        {r.user_id_masked}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 max-w-md text-text-secondary">
                      <span className="line-clamp-2">{r.reason}</span>
                    </td>
                    <td
                      className="px-4 py-2.5 text-text-tertiary"
                      title={r.sanitized_prompt_hash}
                    >
                      {truncateHash(r.sanitized_prompt_hash)}
                    </td>
                    <td
                      className="px-4 py-2.5 text-cyan"
                      title={r.prev_row_hash ?? "(pre-chain row)"}
                    >
                      {r.prev_row_hash
                        ? truncateHash(r.prev_row_hash)
                        : <span className="text-text-tertiary">—</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-10 max-w-3xl text-body-sm text-text-tertiary">
        <strong className="text-text-secondary">
          What an auditor sees here:
        </strong>{" "}
        timestamp, source module, decision, role, masked user identifier,
        reason, and a stable hash of the sanitized prompt. The raw prompt is
        never persisted. IP addresses live in the underlying table (visible
        only to the service role) but are stripped from this demo view.
      </p>
    </div>
  );
}

function truncateHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border-soft bg-surface/60 p-5">
      <div className="flex items-center gap-2 text-text-tertiary">
        {icon}
        <span className="text-mono-xs uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-[15px] font-semibold text-text-primary">
        {value}
      </span>
      <span className="text-mono-xs text-text-tertiary">{sub}</span>
    </div>
  );
}

function EmptyState({
  reason,
  error,
}: {
  reason: "not_configured" | "query_failed";
  error?: string;
}) {
  if (reason === "not_configured") {
    return (
      <div className="p-10 text-center">
        <p className="text-body text-text-secondary">
          Supabase is not configured yet. Add{" "}
          <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-[12px] text-cyan">
            NEXT_PUBLIC_SUPABASE_URL
          </code>
          ,{" "}
          <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-[12px] text-cyan">
            NEXT_PUBLIC_SUPABASE_ANON_KEY
          </code>
          , and{" "}
          <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-[12px] text-cyan">
            SUPABASE_SERVICE_ROLE_KEY
          </code>{" "}
          to your <code>.env.local</code>, run the SQL migration at{" "}
          <code>supabase/migrations/001_audit_logs.sql</code>, and reload.
        </p>
      </div>
    );
  }
  return (
    <div className="p-10 text-center">
      <p className="text-body text-text-secondary">
        Query failed: <span className="font-mono">{error}</span>
      </p>
    </div>
  );
}
