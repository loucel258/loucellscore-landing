import Link from "next/link";
import { Bell, CheckCircle2, ChevronRight, Clock, DollarSign, Inbox } from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { loadToday, type TodayData } from "@/lib/admin/today";
import type { NeedsYouItem } from "@/lib/admin/needs-you";
import { formatHours, formatRelative, formatShortDate, formatUsdFromCents } from "@/lib/admin/format";
import { AuthWall } from "@/components/admin/auth-wall";
import { ActivityFeed, type ActivityEvent } from "@/components/admin/activity-feed";
import { TopBar } from "@/components/shell/topbar";
import { Metric } from "@/components/workspace/metric";
import { Panel } from "@/components/workspace/panel";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Today · Loucells Core admin",
  robots: { index: false, follow: false },
};

function deltaOf(now: number, prev: number): { value: string; direction: "up" | "down" | "flat" } {
  const diff = now - prev;
  if (diff === 0) return { value: "same as last week", direction: "flat" };
  return { value: `${diff > 0 ? "+" : ""}${diff} vs last week`, direction: diff > 0 ? "up" : "down" };
}

function activity(data: TodayData): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const l of data.prospects.recent) {
    events.push({
      id: `lead-${l.id}`,
      type: "lead_captured",
      title: `New prospect${l.name ? `: ${l.name}` : ""}`,
      body: (l.source ?? "").replace(/_/g, " ") || undefined,
      occurredAt: l.created_at,
    });
  }
  const accountNames = new Map(data.overview.base.accounts.map((a) => [a.id, a.account_name]));
  for (const e of data.recentEngagements) {
    const name = (e.account_id && accountNames.get(e.account_id)) || e.client_legal_name;
    if (e.outcome_at && e.status === "converted_to_build") {
      events.push({ id: `conv-${e.id}`, type: "converted", title: `${name} moved to a build`, occurredAt: e.outcome_at });
    } else if (e.delivered_at) {
      events.push({ id: `deliv-${e.id}`, type: "delivered", title: `Delivered to ${name}`, occurredAt: e.delivered_at });
    } else if (e.stripe_paid_at) {
      events.push({ id: `paid-${e.id}`, type: "payment_received", title: `${name} paid`, occurredAt: e.stripe_paid_at });
    } else {
      events.push({
        id: `new-${e.id}`,
        type: "kickoff_held",
        title: `New ${e.engagement_type === "gap_audit" ? "engagement" : "client build"}: ${name}`,
        occurredAt: e.created_at,
      });
    }
  }
  for (const a of data.recentGoLives) {
    events.push({ id: `live-${a.id}`, type: "agent_status_change", title: `${a.name} went live`, occurredAt: a.live_started_at });
  }
  return events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
}

export default async function TodayPage() {
  if (!(await isAdminAuthed())) return <AuthWall />;

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <>
        <TopBar title="Today" />
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <ServiceUnavailable />
        </div>
      </>
    );
  }

  const data = await loadToday(sb);
  const { totals, prospects, needsYou, overview } = data;
  const critical = needsYou.filter((i) => i.tone === "critical").length;

  return (
    <>
      <TopBar
        title="Today"
        subtitle={new Date(overview.now).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone: "America/New_York",
        })}
      />

      <div className="space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link href="/admin/revenue" className="block">
            <Metric
              label="MRR"
              value={formatUsdFromCents(totals.mrrCents)}
              sub={`${totals.payingClients} paying client${totals.payingClients === 1 ? "" : "s"}`}
              tone="accent"
              icon={<DollarSign className="size-4" />}
            />
          </Link>
          <Metric
            label="New prospects · 7 days"
            value={prospects.thisWeek}
            sub="From your site chat"
            delta={deltaOf(prospects.thisWeek, prospects.prevWeek)}
            tone="violet"
            icon={<Inbox className="size-4" />}
          />
          <Link href="/admin/clients" className="block">
            <Metric
              label="Hours saved · 30 days"
              value={formatHours(totals.hours)}
              sub={`${totals.conversations} conversations across ${totals.liveAgents} live agent${totals.liveAgents === 1 ? "" : "s"}`}
              tone="emerald"
              icon={<Clock className="size-4" />}
            />
          </Link>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Panel
            title="Needs you"
            eyebrow={needsYou.length === 0 ? "All clear" : `${needsYou.length} open${critical ? `, ${critical} urgent` : ""}`}
            icon={<Bell className="size-4" />}
            bodyClassName="p-0"
          >
            {needsYou.length === 0 ? (
              <p className="flex items-center gap-2 px-5 py-5 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" /> Nothing needs you right now.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {needsYou.map((item) => (
                  <NeedsYouRow key={item.id} item={item} now={overview.now} />
                ))}
              </ul>
            )}
          </Panel>

          <ActivityFeed
            events={activity(data)}
            emptyMessage="Nothing yet. Prospects, payments and go-lives show up here."
          />
        </div>
      </div>
    </>
  );
}

function NeedsYouRow({ item, now }: { item: NeedsYouItem; now: number }) {
  const when =
    item.kind === "followup"
      ? item.at
        ? `${item.tone === "critical" ? "Overdue since" : "Due"} ${formatShortDate(item.at)}`
        : "No due date"
      : item.at
        ? formatRelative(item.at, now)
        : null;
  return (
    <li>
      <Link href={item.href} className="flex min-h-[56px] items-start gap-3 px-5 py-3 hover:bg-neutral-50">
        <span
          aria-hidden
          className={`mt-1.5 size-2 shrink-0 rounded-full ${item.tone === "critical" ? "bg-rose-500" : "bg-amber-500"}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-neutral-900">
            <span className="sr-only">{item.tone === "critical" ? "Urgent: " : ""}</span>
            {item.title}
          </span>
          {item.detail && <span className="block truncate text-xs text-neutral-500">{item.detail}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-neutral-500">
          {when}
          <ChevronRight className="size-4 text-neutral-400" />
        </span>
      </Link>
    </li>
  );
}
