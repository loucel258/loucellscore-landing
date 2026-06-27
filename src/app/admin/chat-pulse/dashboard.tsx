/**
 * ChatPulseDashboard — read-only operator panel.
 *
 * Pure client component (no interactivity beyond display). Server fetched
 * everything; we just render. Layout intentionally functional/raw — this is
 * for Steven, not prospects. Brand mark + cyan accent for consistency but
 * zero animation, zero polish overhead.
 */

type LeadRow = {
  id: string;
  name: string;
  email: string;
  reason: string;
  booking_status: string;
  booking_slot_iso: string | null;
  created_at: string;
  confirmed_at: string | null;
};

type DenyRow = {
  inserted_at: string;
  decision: string;
  blocked_by: string | null;
  reason: string;
};

type FailRow = {
  inserted_at: string;
  blocked_by: string | null;
  reason: string;
};

export function ChatPulseDashboard({
  data,
}: {
  data: {
    auditCounts24h: { ALLOW: number; DENY: number };
    auditCounts7d: { ALLOW: number; DENY: number };
    blockedBy24h: Record<string, number>;
    leadCounts24h: Record<string, number>;
    leadCounts7d: Record<string, number>;
    leadCounts30d: Record<string, number>;
    leadsAll: LeadRow[];
    deniesLast50: DenyRow[];
    failsLast50: FailRow[];
  };
}) {
  const conversionRate7d =
    data.leadCounts7d.offered + data.leadCounts7d.confirmed === 0
      ? null
      : (data.leadCounts7d.confirmed /
          (data.leadCounts7d.offered + data.leadCounts7d.confirmed)) *
        100;

  const recentFail = data.failsLast50[0];
  const last24hFails = data.failsLast50.filter((r) => {
    return new Date(r.inserted_at).getTime() > Date.now() - 24 * 3600 * 1000;
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
          Chat-pulse
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Loucells Core's own landing chat · ws_chat_loucel_landing · server time{" "}
          {new Date().toLocaleString()}
        </p>
      </div>

      {/* Alert strip */}
      {(last24hFails.length >= 5 ||
        data.blockedBy24h.service_unavailable >= 1 ||
        recentFail) && (
        <div className="mt-4 rounded border border-rose-300 bg-rose-50 p-3 text-sm">
          <strong className="text-rose-700">Attention</strong>
          <ul className="ml-4 mt-1 list-disc text-rose-800">
            {last24hFails.length >= 5 && (
              <li>
                <strong>{last24hFails.length}</strong> chat_failed events in
                last 24h — possible broken deploy or upstream issue
              </li>
            )}
            {data.blockedBy24h.service_unavailable >= 1 && (
              <li>
                <strong>{data.blockedBy24h.service_unavailable}</strong>{" "}
                chat_unavailable events in last 24h — check
                ANTHROPIC_API_KEY env var
              </li>
            )}
            {recentFail && (
              <li>
                Most recent failure:{" "}
                <code className="text-xs">{recentFail.reason.slice(0, 100)}</code>{" "}
                at {new Date(recentFail.inserted_at).toLocaleString()}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* KPI grid */}
      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="ALLOW · 24h"
          value={data.auditCounts24h.ALLOW.toString()}
          sub="audit events"
        />
        <KpiCard
          label="DENY · 24h"
          value={data.auditCounts24h.DENY.toString()}
          sub="blocked / refused"
          accent={data.auditCounts24h.DENY > 5 ? "warn" : undefined}
        />
        <KpiCard
          label="Leads · 24h"
          value={(
            data.leadCounts24h.offered +
            data.leadCounts24h.confirmed +
            data.leadCounts24h.rescheduled
          ).toString()}
          sub={`${data.leadCounts24h.confirmed} confirmed`}
        />
        <KpiCard
          label="Conversion · 7d"
          value={
            conversionRate7d === null
              ? "—"
              : `${conversionRate7d.toFixed(0)}%`
          }
          sub="confirmed / offered"
        />
      </section>

      {/* Last-24h blocked-by breakdown */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-600">
          Blocks · last 24h
        </h2>
        {Object.keys(data.blockedBy24h).length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">no blocks</p>
        ) : (
          <ul className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
            {Object.entries(data.blockedBy24h)
              .sort(([, a], [, b]) => b - a)
              .map(([k, v]) => (
                <li
                  key={k}
                  className="flex items-center justify-between rounded border border-neutral-200 bg-white/55 px-3 py-2 text-sm"
                >
                  <code className="text-xs text-neutral-700">{k}</code>
                  <span className="font-mono font-semibold">{v}</span>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Lead funnel */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-600">
          Lead funnel
        </h2>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
          <FunnelBlock title="24h" counts={data.leadCounts24h} />
          <FunnelBlock title="7d" counts={data.leadCounts7d} />
          <FunnelBlock title="30d" counts={data.leadCounts30d} />
        </div>
      </section>

      {/* Recent leads */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-600">
          Recent leads · last 20
        </h2>
        {data.leadsAll.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">no leads yet</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded border border-neutral-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/55 text-neutral-600">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Slot</th>
                </tr>
              </thead>
              <tbody>
                {data.leadsAll.map((l) => (
                  <tr key={l.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-neutral-500">
                      {new Date(l.created_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2">
                      <a
                        className="text-cyan-700 hover:underline"
                        href={`mailto:${l.email}`}
                      >
                        {l.email}
                      </a>
                    </td>
                    <td className="px-3 py-2 max-w-[24ch] truncate" title={l.reason}>
                      {l.reason}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={l.booking_status} />
                    </td>
                    <td className="px-3 py-2 text-neutral-500">
                      {l.booking_slot_iso
                        ? new Date(l.booking_slot_iso).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent denies */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-600">
          Recent DENYs · last 20
        </h2>
        {data.deniesLast50.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">no denies</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded border border-neutral-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/55 text-neutral-600">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Blocked by</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.deniesLast50.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-neutral-500">
                      {new Date(r.inserted_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-xs">{r.blocked_by ?? "—"}</code>
                    </td>
                    <td className="px-3 py-2 max-w-[60ch] truncate" title={r.reason}>
                      {r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="mt-12 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        chat-pulse · single-operator dashboard · refresh page for latest
      </footer>
    </main>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "warn";
}) {
  return (
    <div
      className={`rounded border p-4 ${
        accent === "warn"
          ? "border-amber-300 bg-amber-50"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

function FunnelBlock({
  title,
  counts,
}: {
  title: string;
  counts: Record<string, number>;
}) {
  const total =
    counts.offered + counts.confirmed + counts.rescheduled + counts.cancelled + counts.abandoned;
  return (
    <div className="rounded border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 p-4">
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {title}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{total}</div>
      <div className="mt-2 space-y-1 text-xs">
        <FunnelRow label="offered" v={counts.offered} />
        <FunnelRow label="confirmed" v={counts.confirmed} accent="ok" />
        <FunnelRow label="rescheduled" v={counts.rescheduled} />
        <FunnelRow label="cancelled" v={counts.cancelled} accent="warn" />
        <FunnelRow label="abandoned" v={counts.abandoned} accent="warn" />
      </div>
    </div>
  );
}

function FunnelRow({
  label,
  v,
  accent,
}: {
  label: string;
  v: number;
  accent?: "ok" | "warn";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-600">{label}</span>
      <span
        className={`font-mono ${
          accent === "ok"
            ? "text-emerald-700"
            : accent === "warn"
              ? "text-rose-600"
              : "text-neutral-700"
        }`}
      >
        {v}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = (() => {
    if (status === "confirmed") return "bg-emerald-100 text-emerald-700";
    if (status === "offered") return "bg-neutral-100 text-neutral-700";
    if (status === "rescheduled") return "bg-amber-100 text-amber-700";
    if (status === "cancelled" || status === "abandoned")
      return "bg-rose-100 text-rose-700";
    return "bg-neutral-100 text-neutral-700";
  })();
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
