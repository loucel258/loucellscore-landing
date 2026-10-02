import Link from "next/link";
import { ShieldCheck, CheckCircle2, Clock, MessageSquare } from "lucide-react";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { requirePortalContext } from "@/lib/portal/context";
import { t, tn, type PortalLang } from "@/lib/portal/strings";
import { actionTypeLabel } from "@/lib/portal/labels";
import { buildApprovalLabels, loadPendingApprovals } from "@/lib/portal/approvals";
import { approvalOutcome, type ApprovalOutcome } from "@/lib/portal/approval-status";
import { isMissingColumn } from "@/lib/portal/db-errors";
import { conversationHref } from "@/lib/portal/threads";
import { can } from "@/lib/portal/roles";
import { decidedByLabel, loadDeciderNames } from "@/lib/portal/deciders";
import { formatWhen } from "@/lib/portal/time";
import { Panel } from "@/components/workspace/panel";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { ApprovalCard } from "./approval-card";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HistoryRow = {
  id: string;
  action_type: string;
  proposed_text: string;
  status: string;
  decided_at: string | null;
  execution_status: string | null;
  decision_reason: string | null;
  failure_reason: string | null;
  decider_id?: string | null;
  session_id?: string | null;
  contact_id?: string | null;
};

// Read server-side to derive the outcome only: decision_reason and
// failure_reason are internal and never rendered.
const HISTORY_COLS = "id, action_type, proposed_text, status, decided_at, execution_status, decision_reason, failure_reason, decider_id";

const OUTCOME_TONE: Record<ApprovalOutcome, string> = {
  sent: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  handling: "bg-amber-50 text-amber-800 ring-amber-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  rejected: "bg-neutral-100 text-neutral-700 ring-neutral-200",
};

export default async function ApprovalsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePortalContext(slug);
  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;
  const { lang, tz, workspaceIds } = ctx;

  if (workspaceIds.length === 0) {
    return (
      <div className="space-y-6">
        <Header empty lang={lang} />
        <Panel>
          <EmptyPanel
            icon={<ShieldCheck className="size-5" />}
            title={t(lang, "ra.clear_title")}
            description={t(lang, "ra.subtitle_no_agent")}
          />
        </Panel>
      </div>
    );
  }

  const runHistory = (cols: string) =>
    sb
      .from("pending_approvals")
      .select(cols)
      .in("workspace_id", workspaceIds)
      .neq("status", "pending")
      .order("decided_at", { ascending: false })
      .limit(20);

  const [pending, historyFirst] = await Promise.all([
    loadPendingApprovals(sb, slug, workspaceIds, lang),
    runHistory(`${HISTORY_COLS}, session_id, contact_id`),
  ]);
  // Before migration 062 the link columns don't exist: history without links.
  const historyRes =
    historyFirst.error && isMissingColumn(historyFirst.error) ? await runHistory(HISTORY_COLS) : historyFirst;
  const history = (historyRes.data as unknown as HistoryRow[] | null) ?? [];
  // "Approved by Maria": names of the people who decided (migration 069).
  const deciderNames = await loadDeciderNames(sb, ctx.engagementId, history.map((r) => r.decider_id));
  const canDecide = can(ctx.actor.role, "decide_approvals");
  const labels = buildApprovalLabels(lang);

  return (
    <div className="space-y-6">
      <Header pendingCount={pending.length} lang={lang} />

      {pending.length === 0 ? (
        <Panel tone="success">
          <div className="flex items-center gap-4 py-2">
            <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <CheckCircle2 className="size-6" />
            </span>
            <div>
              <p className="text-base font-semibold text-neutral-900">{t(lang, "ra.clear_title")}</p>
              <p className="text-sm text-neutral-600">{t(lang, "ra.clear_desc")}</p>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="space-y-4">
          {pending.map((p) => (
            <ApprovalCard key={p.id} approval={p} slug={slug} labels={labels} canDecide={canDecide} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <Panel title={t(lang, "ra.history_title")} eyebrow={t(lang, "ra.history_eyebrow")} icon={<Clock className="size-4" />}>
          <ul className="divide-y divide-neutral-100">
            {history.map((r) => {
              const outcome = approvalOutcome(r);
              const href = conversationHref(slug, r);
              const decidedBy = decidedByLabel(lang, r.status, r.decider_id, deciderNames);
              return (
                <li key={r.id} className="flex items-start justify-between gap-3 py-3 text-xs">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${OUTCOME_TONE[outcome]}`}
                      >
                        {t(lang, `ra.outcome.${outcome}`)}
                      </span>
                      <span className="text-neutral-700">{actionTypeLabel(lang, r.action_type)}</span>
                      {decidedBy && <span className="font-medium text-neutral-800">· {decidedBy}</span>}
                    </div>
                    <p className="mt-1 line-clamp-1 max-w-xl text-[11px] text-neutral-500">{r.proposed_text}</p>
                    {href && (
                      <Link href={href} className="mt-1 inline-flex min-h-6 items-center gap-1 text-[11px] font-medium text-cyan-700 hover:underline">
                        <MessageSquare className="size-3" /> {t(lang, "ra.open_conversation")}
                      </Link>
                    )}
                  </div>
                  <span className="shrink-0 text-[10.5px] text-neutral-500" suppressHydrationWarning>
                    {r.decided_at ? formatWhen(r.decided_at, lang, tz) : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] text-neutral-500">{t(lang, "ra.history_note")}</p>
        </Panel>
      )}
    </div>
  );
}

function Header({ pendingCount, empty, lang }: { pendingCount?: number; empty?: boolean; lang: PortalLang }) {
  return (
    <header>
      <h1 className="text-neutral-900">{t(lang, "ra.title")}</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {empty
          ? t(lang, "ra.subtitle_no_agent")
          : pendingCount && pendingCount > 0
            ? tn(lang, "ra.subtitle_pending", pendingCount)
            : t(lang, "ra.subtitle_empty")}
      </p>
    </header>
  );
}
