import Link from "next/link";
import { AlertTriangle, ChevronRight, Plus, Users } from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { loadClientsOverview } from "@/lib/admin/clients";
import { loadClientListExtras, type ClientListExtra, type ClientListExtras } from "@/lib/admin/client-extras";
import type { ClientRow, PipelineLane } from "@/lib/admin/client-list";
import { formatHours, formatRelative, formatUsdFromCents } from "@/lib/admin/format";
import { ChannelChips } from "@/components/admin/channel-chips";
import { AuthWall } from "@/components/admin/auth-wall";
import { EmptyState } from "@/components/admin/empty-state";
import { LifecycleBadge } from "@/components/admin/lifecycle-badge";
import { StatusBadge } from "@/components/admin/status-badge";
import { TopBar } from "@/components/shell/topbar";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Clients · Loucells Core admin",
  robots: { index: false, follow: false },
};

/**
 * Every client in one list (replaces CRM, Clients and Agents). Toggle to
 * the engagement pipeline with ?view=pipeline. Cards on a phone, a table
 * from sm up.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  if (!(await isAdminAuthed())) return <AuthWall />;
  const { view: rawView } = await searchParams;
  const view = (Array.isArray(rawView) ? rawView[0] : rawView) === "pipeline" ? "pipeline" : "list";

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <>
        <TopBar title="Clients" />
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <ServiceUnavailable />
        </div>
      </>
    );
  }

  const overview = await loadClientsOverview(sb);
  const { rows, pipeline } = overview;
  const extras = view === "list" && rows.length > 0 ? await loadClientListExtras(sb, overview) : null;
  const mrr = rows.reduce((s, r) => s + r.mrrCents, 0);
  const quiet = rows.filter((r) => r.quiet).length;

  return (
    <>
      <TopBar
        title="Clients"
        subtitle={`${rows.length} client${rows.length === 1 ? "" : "s"} · ${formatUsdFromCents(mrr)} MRR${
          quiet > 0 ? ` · ${quiet} quiet` : ""
        }`}
        actions={
          <Link
            href="/admin/clients/new"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-700"
          >
            <Plus className="size-4" /> New client
          </Link>
        }
        tabs={<ViewToggle view={view} />}
      />

      <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="No clients yet"
            description="Add a client to create their account, engagement, agent and portal in one step."
            cta={{ label: "New client", href: "/admin/clients/new" }}
          />
        ) : view === "pipeline" ? (
          <PipelineBoard lanes={pipeline} />
        ) : (
          <>
            {extras && !extras.valueReadable && (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Value and channel checks need migration 065 (read access to appointments, messages and the vault
                presence check). Until it is applied, value shows as n/a.
              </p>
            )}
            <ClientCards rows={rows} extras={extras} now={overview.now} />
            <ClientTable rows={rows} extras={extras} now={overview.now} />
          </>
        )}
      </div>
    </>
  );
}

function ViewToggle({ view }: { view: "list" | "pipeline" }) {
  const item = (key: "list" | "pipeline", label: string, href: string) => (
    <Link
      href={href}
      aria-current={view === key ? "page" : undefined}
      className={`inline-flex min-h-[44px] items-center border-b-2 px-3 text-[13px] font-medium ${
        view === key
          ? "border-cyan-500 text-neutral-900"
          : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-900"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Clients view" className="flex items-end gap-1">
      {item("list", "List", "/admin/clients")}
      {item("pipeline", "Pipeline", "/admin/clients?view=pipeline")}
    </nav>
  );
}

function Tags({ row }: { row: ClientRow }) {
  return (
    <>
      {row.isHouse && (
        <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200">
          Your site
        </span>
      )}
      {row.quiet && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700">
          <AlertTriangle className="size-3" /> Quiet
        </span>
      )}
    </>
  );
}

function Dash() {
  return <span className="text-neutral-300">0</span>;
}

function portalText(x: ClientListExtra | undefined, now: number): string {
  if (!x) return "";
  if (x.portal.portals === 0) return "No portal";
  if (!x.portal.lastLoginAt) return "Never signed in";
  return `${formatRelative(x.portal.lastLoginAt, now)} · ${x.portal.loginCount} visit${x.portal.loginCount === 1 ? "" : "s"}`;
}

function valueMoney(x: ClientListExtra | undefined): string {
  if (!x?.value30d) return "n/a";
  return x.value30d.revenueCents > 0 ? formatUsdFromCents(x.value30d.revenueCents) : "$0";
}

function SilentTag({ x }: { x: ClientListExtra | undefined }) {
  if (!x?.silentDays) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700">
      <AlertTriangle className="size-3" /> No traffic {x.silentDays}d
    </span>
  );
}

/** Phone: one card per client. */
function ClientCards({ rows, extras, now }: { rows: ClientRow[]; extras: ClientListExtras | null; now: number }) {
  return (
    <ul className="space-y-2 sm:hidden">
      {rows.map((r) => {
        const x = extras?.byKey.get(r.key);
        return (
        <li key={r.key}>
          <Link
            href={r.href}
            className="block rounded-xl border border-neutral-200 bg-white p-3.5 active:bg-neutral-50"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-neutral-900">{r.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <LifecycleBadge lifecycle={r.lifecycle} />
                  {r.latestStatus && <StatusBadge status={r.latestStatus} />}
                  <Tags row={r} />
                </div>
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-neutral-400" />
            </div>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
              <Stat label="MRR" value={r.mrrCents > 0 ? formatUsdFromCents(r.mrrCents) : "0"} />
              <Stat label="Value 30d" value={valueMoney(x)} />
              <Stat label="Bookings" value={x?.value30d ? String(x.value30d.bookings) : "n/a"} />
              <Stat label="Convos" value={String(r.conversations30d)} />
            </dl>
            {x && (
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <ChannelChips chips={x.chips} />
                  <SilentTag x={x} />
                </div>
                <span className="text-[11px] text-neutral-500">Portal: {portalText(x, now)}</span>
              </div>
            )}
          </Link>
        </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-1 py-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-900">{value}</dd>
    </div>
  );
}

/** sm and up: a table. Value, conversations and hours are the last 30 days. */
function ClientTable({ rows, extras, now }: { rows: ClientRow[]; extras: ClientListExtras | null; now: number }) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-neutral-200 bg-white sm:block">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-600">
          <tr>
            <th className="px-4 py-2.5 font-medium">Client</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="hidden px-4 py-2.5 font-medium md:table-cell">Health</th>
            <th className="px-4 py-2.5 text-right font-medium">MRR</th>
            <th className="px-4 py-2.5 text-right font-medium">Value 30d</th>
            <th className="px-4 py-2.5 text-right font-medium">Conversations</th>
            <th className="hidden px-4 py-2.5 text-right font-medium xl:table-cell">Hours saved</th>
            <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Last portal visit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => {
            const x = extras?.byKey.get(r.key);
            return (
            <tr key={r.key} className="hover:bg-neutral-50">
              <td className="px-4 py-3">
                <Link href={r.href} className="font-medium text-neutral-900 hover:text-cyan-700">
                  {r.name}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {r.vertical && <span className="text-[11px] text-neutral-500">{r.vertical}</span>}
                  <Tags row={r} />
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <LifecycleBadge lifecycle={r.lifecycle} />
                  {r.latestStatus && <StatusBadge status={r.latestStatus} />}
                </div>
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                {x ? (
                  <div className="space-y-1">
                    <ChannelChips chips={x.chips} empty={r.agentCount ? "No channels on" : "No agent"} />
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                      <span>{r.liveAgents} live</span>
                      <SilentTag x={x} />
                    </div>
                  </div>
                ) : (
                  <Dash />
                )}
              </td>
              <td className="px-4 py-3 text-right font-medium tabular-nums text-neutral-900">
                {r.mrrCents > 0 ? formatUsdFromCents(r.mrrCents) : <Dash />}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                {x?.value30d ? (
                  <>
                    <span className="block font-medium text-neutral-900">{valueMoney(x)}</span>
                    <span className="block text-[11px] text-neutral-500">
                      {x.value30d.bookings} booking{x.value30d.bookings === 1 ? "" : "s"}
                    </span>
                  </>
                ) : (
                  <span className="text-neutral-400">n/a</span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                {r.conversations30d || <Dash />}
              </td>
              <td className="hidden px-4 py-3 text-right tabular-nums text-neutral-700 xl:table-cell">
                {r.hoursSaved30d > 0 ? formatHours(r.hoursSaved30d) : <Dash />}
              </td>
              <td className="hidden px-4 py-3 text-[12px] text-neutral-600 lg:table-cell">
                {x ? portalText(x, now) : <Dash />}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-500">
        Value, conversations and hours saved cover the last 30 days. Value = revenue from completed bookings where the
        customer talked to the agent first, and bookings the agent made or helped make. Quiet = paying, but no
        customer conversation in 14 days. Health chips: green working, amber not switched on, red needs setup.
      </p>
    </div>
  );
}

function PipelineBoard({ lanes }: { lanes: PipelineLane[] }) {
  if (lanes.length === 0) {
    return (
      <EmptyState
        title="No engagements in the pipeline"
        description="Engagements show up here by stage once they exist."
      />
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {lanes.map((lane) => (
        <section key={lane.key} className="flex flex-col rounded-xl border border-neutral-200 bg-white">
          <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
            <h2 className="text-xs font-semibold text-neutral-700">{lane.label}</h2>
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-neutral-500 ring-1 ring-neutral-200">
              {lane.cards.length}
            </span>
          </header>
          <ul className="flex flex-col gap-2 p-2">
            {lane.cards.map((c) => (
              <li key={c.engagementId}>
                <Link
                  href={c.href}
                  className="block min-h-[44px] rounded-lg border border-neutral-200 bg-white p-2.5 hover:border-cyan-300"
                >
                  <p className="truncate text-sm font-semibold text-neutral-900">{c.clientName}</p>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] capitalize text-neutral-600">{c.type.replace(/_/g, " ")}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-neutral-500">{c.ref}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
