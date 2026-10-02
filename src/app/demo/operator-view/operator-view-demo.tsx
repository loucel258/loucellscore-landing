"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  DollarSign,
  GraduationCap,
  Globe,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Pin,
  Settings as SettingsIcon,
  Share2,
  Shield,
  ShieldCheck,
  ShieldX,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wifi,
  X,
} from "lucide-react";
import {
  AGENT,
  AUDIT_SUMMARY,
  CAPTURE_RATE,
  CONVERSATION_VOLUME,
  COST_METRIC,
  FUNNEL_DATA,
  HITL_QUEUE,
  HITL_RESPONSE_TIME,
  INTEGRATIONS,
  KNOWLEDGE_GAPS,
  KPIS,
  RECENT_MESSAGES,
  SAFETY_COUNTERS,
  SAFETY_EVENTS,
  SETTINGS,
  TODAY_AGENDA,
  type HitlItem,
  type Integration,
  type KnowledgeGap,
  type MessageItem,
  type SafetyEvent,
  type TraceStep,
} from "@/lib/demos/operator-mock-data";
import {
  loadVisitorChatTrace,
  type VisitorChatTrace,
} from "@/lib/demos/visitor-chat-trace";

type ToastState = { kind: "approved" | "edited" | "skipped"; label: string } | null;
type PeriodKey = "today" | "week" | "month";

type TraceOpen = { messageId: string; customer: string; channel: MessageItem["channel"]; trace: TraceStep[] } | null;

export function OperatorViewDemo() {
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [hitlQueue, setHitlQueue] = useState<HitlItem[]>(HITL_QUEUE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trace, setTrace] = useState<TraceOpen>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [visitorTrace, setVisitorTrace] = useState<VisitorChatTrace | null>(null);
  const reduceMotion = useReducedMotion();

  // On mount, try to load the visitor's real chat audit trail from Supabase.
  // If they've chatted with the landing widget, we render a special "Your
  // chat" card at the top of the activity feed that opens a trace replay
  // built from their actual audit rows.
  useEffect(() => {
    let cancelled = false;
    loadVisitorChatTrace().then((vt) => {
      if (!cancelled) setVisitorTrace(vt);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const showToast = useCallback((next: NonNullable<ToastState>) => {
    setToast(next);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const removeHitlItem = useCallback(
    (id: string, action: "approved" | "edited" | "skipped", label: string) => {
      setHitlQueue((q) => q.filter((it) => it.id !== id));
      showToast({ kind: action, label });
    },
    [showToast],
  );

  return (
    <div
      className="min-h-screen text-slate-900"
      style={{
        background:
          "linear-gradient(180deg, #F8FBFF 0%, #EEF5FF 40%, #E8F1FF 100%)",
      }}
    >
      {/* Subtle dot grid background */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.4]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgb(148 163 184 / 0.32) 1px, transparent 0)",
          backgroundSize: "32px 32px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 70%)",
        }}
      />
      {/* Ambient brand glows */}
      <BrandGlows />

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/en"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <ArrowLeft size={13} />
              Loucells Core
            </Link>
            <span aria-hidden className="text-slate-300">/</span>
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block size-4 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle at 35% 35%, #A78BFA 0%, #7C3AED 40%, #06B6D4 100%)",
                  boxShadow: "0 0 12px rgba(124, 58, 237, 0.35)",
                }}
              />
              <span className="text-xs font-medium uppercase tracking-wider text-slate-700">
                Operator view
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LiveIndicator />
            <PeriodSelector value={period} onChange={setPeriod} />
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <SettingsIcon size={13} />
              Settings
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10">
        {/* Greeting */}
        <GreetingBlock period={period} />

        {/* Zone 0 — Agent Identity */}
        <section className="mt-7">
          <AgentIdentityCard />
        </section>

        {/* Zone 1 — KPI strip */}
        <section className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            tone="cyan"
            label="Conversations"
            subtitle="Today"
            value={KPIS.conversations.value}
            delta={KPIS.conversations.deltaPct}
            previousLabel="19 yesterday"
            decoration={<KpiDecorWaves />}
          />
          <KpiCard
            tone="violet"
            label="Pending approvals"
            subtitle="Need your call"
            value={hitlQueue.length}
            delta={KPIS.pending.deltaPct}
            previousLabel="4 yesterday"
            decoration={<KpiDecorStack />}
            urgent={hitlQueue.length > 0}
            focal
          />
          <KpiCard
            tone="emerald"
            label="Captures"
            subtitle="Leads + bookings"
            value={KPIS.captures.value}
            delta={KPIS.captures.deltaPct}
            previousLabel="6 yesterday"
            decoration={<KpiDecorChevrons />}
          />
          <KpiCard
            tone="amber"
            label="Escalations"
            subtitle="Human takeover"
            value={KPIS.escalations.value}
            delta={KPIS.escalations.deltaPct}
            previousLabel="1 yesterday"
            decoration={<KpiDecorTriangle />}
          />
          <KpiCard
            tone="sky"
            label="Spend"
            subtitle={`$${COST_METRIC.perConversationUsd.toFixed(2)} per conversation`}
            value={COST_METRIC.weeklySpendUsd}
            delta={0}
            previousLabel={`$${COST_METRIC.cohortAvgUsd.toFixed(2)} cohort avg · ${Math.round(
              ((COST_METRIC.cohortAvgUsd - COST_METRIC.perConversationUsd) /
                COST_METRIC.cohortAvgUsd) *
                100,
            )}% under`}
            decoration={<KpiDecorWaves />}
            valuePrefix="$"
            valueSuffix="/wk"
          />
        </section>

        {/* Zone 2 + 3 — HITL (focal) + Analytics */}
        <section className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <HitlPanel queue={hitlQueue} onResolve={removeHitlItem} />
          </div>
          <div className="lg:col-span-3">
            <AnalyticsPanel reduceMotion={!!reduceMotion} />
          </div>
        </section>

        {/* Zone 3.5 — Integrations status */}
        <section className="mt-6">
          <IntegrationsPanel />
        </section>

        {/* Zone 3.6 — Knowledge gaps */}
        <section className="mt-6">
          <KnowledgeGapsPanel />
        </section>

        {/* Zone 3.7 — Safety events (Trust Stack made visible) */}
        <section className="mt-6">
          <SafetyEventsPanel />
        </section>

        {/* Zone 4 + 5 — Agenda + Message timeline */}
        <section className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <AgendaPanel />
          </div>
          <div className="lg:col-span-3">
            <TimelinePanel
              visitorTrace={visitorTrace}
              onOpenTrace={(m) =>
                m.trace &&
                setTrace({
                  messageId: m.id,
                  customer: m.customer,
                  channel: m.channel,
                  trace: m.trace,
                })
              }
              onOpenVisitorTrace={() => {
                if (
                  !visitorTrace ||
                  !visitorTrace.hasSession ||
                  !visitorTrace.latestTurn
                )
                  return;
                setTrace({
                  messageId: "visitor-session",
                  customer: "You · landing chat",
                  channel: "web",
                  trace: visitorTrace.latestTurn.trace,
                });
              }}
            />
          </div>
        </section>

        {/* Zone 6 — Audit summary */}
        <section className="mt-6">
          <AuditPanel />
        </section>

        {/* Bottom CTA — closes GAP-A2 (operator view orphaned). A prospect
            who lands here from a share/DM needs a way back into the funnel. */}
        <section className="mt-12 flex flex-col items-center gap-4 rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50/60 to-white px-6 py-8 text-center">
          <p className="text-sm font-medium text-slate-700">
            This is what your team sees every day. Want one built for your business?
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-500"
            >
              Talk to the AI Front Desk
              <ArrowUpRight size={13} />
            </Link>
            <Link
              href="/services/operations-gap-audit"
              className="inline-flex items-center gap-2 rounded-md border border-cyan-300 bg-white px-4 py-2 text-xs font-medium text-cyan-700 transition-colors hover:border-cyan-400 hover:bg-cyan-50"
            >
              Start with an Operations Gap Audit
              <ArrowUpRight size={13} />
            </Link>
          </div>
        </section>

        <footer className="mt-10 pt-6">
          <p className="text-center text-[11px] uppercase tracking-wider text-slate-400">
            Demo · all data is fake · click anything · nothing breaks
          </p>
        </footer>
      </main>

      {/* Settings drawer */}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Trace drawer */}
      <TraceDrawer open={trace} onClose={() => setTrace(null)} />

      {/* Toast */}
      <ToastView toast={toast} />
    </div>
  );
}

// =============================================================================
// Atmosphere — soft ambient glows that anchor the brand without being loud
// =============================================================================

function BrandGlows() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed -left-32 -top-40 -z-10 size-[520px] rounded-full opacity-50 blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, rgba(6,182,212,0.30) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -right-32 top-1/3 -z-10 size-[460px] rounded-full opacity-40 blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, rgba(124,58,237,0.25) 0%, transparent 70%)",
        }}
      />
    </>
  );
}

// =============================================================================
// Header bits
// =============================================================================

function LiveIndicator() {
  const [elapsed, setElapsed] = useState(2);
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => (s >= 59 ? 0 : s + 1)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="hidden items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50/70 px-2 py-1 text-[11px] font-medium text-emerald-700 sm:inline-flex">
      <span className="relative inline-flex size-1.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
      </span>
      Live · last sync {elapsed}s ago
    </div>
  );
}

function PeriodSelector({
  value,
  onChange,
}: {
  value: PeriodKey;
  onChange: (k: PeriodKey) => void;
}) {
  const options: { key: PeriodKey; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
  ];
  return (
    <div className="inline-flex items-center rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`relative rounded-md px-2.5 py-1 text-xs transition-colors ${
              active ? "text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {active && (
              <motion.span
                layoutId="period-active"
                className="absolute inset-0 rounded-md bg-slate-100"
                transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function GreetingBlock({ period }: { period: PeriodKey }) {
  const now = new Date();
  const dayLabel = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
        <Calendar size={12} />
        {dayLabel}
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-[34px]">
        Here&apos;s your {period === "today" ? "day" : period === "week" ? "week" : "month"}.
      </h1>
      <p className="text-sm text-slate-500">
        Approve what matters. The agent handles the rest.
      </p>
    </div>
  );
}

// =============================================================================
// KPI Cards — each with distinctive color + SVG decoration + "vs prev" subtext
// =============================================================================

type Tone = "cyan" | "violet" | "emerald" | "amber" | "sky";

const TONE_STYLES: Record<
  Tone,
  {
    cardBg: string;
    cardBorder: string;
    accent: string;
    accentSoft: string;
    chip: string;
    decorOpacity: string;
  }
> = {
  cyan: {
    cardBg: "from-cyan-50 to-white",
    cardBorder: "border-cyan-200/70",
    accent: "text-cyan-700",
    accentSoft: "text-cyan-600",
    chip: "bg-cyan-100 text-cyan-700",
    decorOpacity: "text-cyan-500/30",
  },
  violet: {
    cardBg: "from-violet-50 to-white",
    cardBorder: "border-violet-200/70",
    accent: "text-violet-700",
    accentSoft: "text-violet-600",
    chip: "bg-violet-100 text-violet-700",
    decorOpacity: "text-violet-500/30",
  },
  emerald: {
    cardBg: "from-emerald-50 to-white",
    cardBorder: "border-emerald-200/70",
    accent: "text-emerald-700",
    accentSoft: "text-emerald-600",
    chip: "bg-emerald-100 text-emerald-700",
    decorOpacity: "text-emerald-500/30",
  },
  amber: {
    cardBg: "from-amber-50 to-white",
    cardBorder: "border-amber-200/70",
    accent: "text-amber-700",
    accentSoft: "text-amber-600",
    chip: "bg-amber-100 text-amber-700",
    decorOpacity: "text-amber-500/30",
  },
  sky: {
    cardBg: "from-sky-50 to-white",
    cardBorder: "border-sky-200/70",
    accent: "text-sky-700",
    accentSoft: "text-sky-600",
    chip: "bg-sky-100 text-sky-700",
    decorOpacity: "text-sky-500/30",
  },
};

function KpiCard({
  tone,
  label,
  subtitle,
  value,
  delta,
  previousLabel,
  decoration,
  urgent,
  focal,
  valuePrefix,
  valueSuffix,
}: {
  tone: Tone;
  label: string;
  subtitle: string;
  value: number;
  delta: number;
  previousLabel: string;
  decoration: React.ReactNode;
  urgent?: boolean;
  focal?: boolean;
  valuePrefix?: string;
  valueSuffix?: string;
}) {
  const s = TONE_STYLES[tone];
  const trendUp = delta >= 0;
  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border ${s.cardBorder} bg-gradient-to-br ${s.cardBg} p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
        focal ? "ring-1 ring-violet-200" : ""
      }`}
    >
      {/* Abstract SVG decoration in corner */}
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-4 -top-4 size-32 ${s.decorOpacity}`}
      >
        {decoration}
      </div>

      <div className="relative flex flex-col gap-3.5">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {label}
            </p>
            <p className="text-[11px] text-slate-400">{subtitle}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {urgent && (
              <span className="relative inline-flex size-2" aria-hidden>
                <span className="absolute inset-0 animate-ping rounded-full bg-violet-400 opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-violet-500" />
              </span>
            )}
            <button
              type="button"
              aria-label="Card menu"
              className="rounded-md p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="flex items-baseline">
            {valuePrefix && (
              <span className={`text-2xl font-semibold leading-none ${s.accent}`}>
                {valuePrefix}
              </span>
            )}
            <AnimatedNumber
              value={value}
              className={`text-[40px] font-semibold tabular-nums leading-none tracking-tight ${s.accent}`}
            />
            {valueSuffix && (
              <span className={`ml-1 text-sm font-medium ${s.accentSoft}`}>
                {valueSuffix}
              </span>
            )}
          </div>
          {delta !== 0 && (
            <span
              className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                trendUp ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              {trendUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {trendUp ? "+" : ""}
              {delta}%
            </span>
          )}
        </div>

        <div className="border-t border-slate-200/80 pt-2.5">
          <p className="text-[11px] text-slate-500">
            <span className="text-slate-400">vs. </span>
            {previousLabel}
          </p>
        </div>
      </div>
    </article>
  );
}

function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  // One count-up from 0 toward the first value, unless the user prefers
  // reduced motion. While it runs, `tween` holds the frame on screen; any
  // other time (finished, cancelled, or a later value) the value shows as is.
  const [tween, setTween] = useState<{ target: number; shown: number } | null>(() =>
    reduce ? null : { target: value, shown: 0 },
  );
  const startedRef = useRef(false);

  useEffect(() => {
    if (reduce || startedRef.current) return;
    startedRef.current = true;
    const start = performance.now();
    const duration = 950;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setTween({ target: value, shown: Math.round(eased * value) });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      // Interrupted (new value, unmount): stop showing the count-up frame.
      setTween(null);
    };
  }, [value, reduce]);

  const display = tween && tween.target === value ? tween.shown : value;
  return <span className={className}>{display}</span>;
}

// Decoration SVGs — abstract shapes that add personality without being literal
function KpiDecorWaves() {
  return (
    <svg viewBox="0 0 128 128" fill="none" className="size-full">
      <path d="M0 64 Q 32 32, 64 64 T 128 64" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M0 80 Q 32 48, 64 80 T 128 80" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.6" />
      <path d="M0 48 Q 32 16, 64 48 T 128 48" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.4" />
      <circle cx="100" cy="32" r="14" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function KpiDecorStack() {
  return (
    <svg viewBox="0 0 128 128" fill="none" className="size-full">
      <rect x="32" y="20" width="80" height="14" rx="3" fill="currentColor" opacity="0.55" />
      <rect x="42" y="40" width="70" height="14" rx="3" fill="currentColor" opacity="0.4" />
      <rect x="52" y="60" width="60" height="14" rx="3" fill="currentColor" opacity="0.28" />
      <rect x="62" y="80" width="50" height="14" rx="3" fill="currentColor" opacity="0.18" />
    </svg>
  );
}

function KpiDecorChevrons() {
  return (
    <svg viewBox="0 0 128 128" fill="none" className="size-full">
      <path d="M40 80 L70 50 L100 80" stroke="currentColor" strokeWidth="3" fill="none" strokeLinejoin="round" />
      <path d="M40 60 L70 30 L100 60" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinejoin="round" opacity="0.6" />
      <path d="M40 40 L70 10 L100 40" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" opacity="0.35" />
    </svg>
  );
}

function KpiDecorTriangle() {
  return (
    <svg viewBox="0 0 128 128" fill="none" className="size-full">
      <polygon points="64,16 110,96 18,96" fill="currentColor" opacity="0.35" />
      <polygon points="64,40 92,88 36,88" fill="currentColor" opacity="0.55" />
      <circle cx="64" cy="72" r="4" fill="currentColor" opacity="0.9" />
      <rect x="62" y="55" width="4" height="12" rx="2" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

// =============================================================================
// HITL Panel — focal, with priority bars + tinted action buttons
// =============================================================================

function HitlPanel({
  queue,
  onResolve,
}: {
  queue: HitlItem[];
  onResolve: (id: string, action: "approved" | "edited" | "skipped", label: string) => void;
}) {
  return (
    <div
      className="relative h-full overflow-hidden rounded-2xl border border-violet-200/80 bg-white p-5 shadow-md shadow-violet-500/[0.07]"
    >
      {/* Focal gradient stripe at top */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{
          background:
            "linear-gradient(90deg, #06B6D4 0%, #7C3AED 50%, #A78BFA 100%)",
        }}
      />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-lg bg-violet-100">
            <Sparkles size={16} className="text-violet-700" strokeWidth={1.8} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
              Pending approvals
            </h2>
            <p className="mt-0.5 text-[11.5px] text-slate-500">
              High-stakes actions the agent flagged for you
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-medium text-violet-700">
          <span className="relative inline-flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-violet-400" />
            <span className="relative inline-flex size-1.5 rounded-full bg-violet-500" />
          </span>
          {queue.length} waiting
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <AnimatePresence mode="popLayout">
          {queue.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-12 text-center"
            >
              <div className="inline-flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check size={16} />
              </div>
              <p className="text-sm font-medium text-slate-700">Inbox zero</p>
              <p className="text-xs text-slate-500">
                Nothing waiting on your approval right now. The agent will ping you when something needs your call.
              </p>
            </motion.div>
          )}
          {queue.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95, transition: { duration: 0.25 } }}
              transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
            >
              <HitlCard item={item} onResolve={onResolve} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function HitlCard({
  item,
  onResolve,
}: {
  item: HitlItem;
  onResolve: (id: string, action: "approved" | "edited" | "skipped", label: string) => void;
}) {
  const meta = getHitlMeta(item);
  return (
    <article
      className={`group relative overflow-hidden rounded-xl border ${meta.borderClass} bg-white p-4 transition-all hover:shadow-md hover:shadow-slate-900/[0.04]`}
    >
      <div aria-hidden className={`absolute inset-y-0 left-0 w-1 ${meta.stripeClass}`} />

      {/* Header row */}
      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="flex items-center gap-2.5">
          <span className={`inline-flex size-8 items-center justify-center rounded-lg ${meta.iconBgClass}`}>
            {meta.icon}
          </span>
          <div>
            <p className="text-[13.5px] font-semibold text-slate-900">{meta.title}</p>
            <p className="text-[10.5px] font-medium uppercase tracking-wider text-slate-500">
              {item.vertical}
              {item.platform ? ` · ${item.platform}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <PriorityBars urgency={item.urgency} />
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-400">
            <Clock size={9} />
            {item.ageMinutes}m
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="mt-3 flex flex-col gap-2 pl-1 text-[13px] text-slate-700">
        <p>
          <span className="text-slate-500">Customer: </span>
          <span className="font-medium text-slate-900">{item.customer}</span>
        </p>
        <p className="text-slate-600">{item.context}</p>
        {item.draftBody && (
          <blockquote className="mt-1 rounded-md border-l-2 border-violet-300 bg-violet-50/50 px-3 py-2 text-[12.5px] italic text-slate-700">
            &ldquo;{item.draftBody}&rdquo;
          </blockquote>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
        <ActionButton
          variant="primary"
          onClick={() => onResolve(item.id, "approved", `${meta.title} approved`)}
          icon={<ShieldCheck size={13} />}
        >
          Approve
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={() => onResolve(item.id, "edited", `${meta.title} edited & sent`)}
          icon={<MessageSquare size={13} />}
        >
          Edit
        </ActionButton>
        <ActionButton
          variant="ghost"
          onClick={() => onResolve(item.id, "skipped", `${meta.title} skipped`)}
          icon={<ShieldX size={13} />}
        >
          Skip
        </ActionButton>
      </div>
    </article>
  );
}

function PriorityBars({ urgency }: { urgency: "normal" | "high" }) {
  const high = urgency === "high";
  return (
    <span
      className={`inline-flex items-end gap-0.5 rounded-md px-1.5 py-1 ${
        high ? "bg-rose-50" : "bg-slate-50"
      }`}
      aria-label={high ? "Urgent priority" : "Normal priority"}
      title={high ? "Urgent" : "Normal"}
    >
      <span
        className={`block w-[3px] rounded-sm ${high ? "bg-rose-500" : "bg-slate-300"}`}
        style={{ height: 6 }}
      />
      <span
        className={`block w-[3px] rounded-sm ${high ? "bg-rose-500" : "bg-slate-400"}`}
        style={{ height: 10 }}
      />
      <span
        className={`block w-[3px] rounded-sm ${high ? "bg-rose-500" : "bg-slate-200"}`}
        style={{ height: 14 }}
      />
      {high && (
        <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-rose-600">
          urgent
        </span>
      )}
    </span>
  );
}

function getHitlMeta(item: HitlItem) {
  switch (item.kind) {
    case "quote":
      return {
        title: `Quote · $${item.amount?.toLocaleString()}`,
        icon: <Sparkles size={14} className="text-cyan-700" />,
        iconBgClass: "bg-cyan-100",
        borderClass: "border-slate-200",
        stripeClass: "bg-cyan-500",
      };
    case "review":
      return {
        title: `${item.rating}★ review reply`,
        icon: <MessageCircle size={14} className="text-violet-700" />,
        iconBgClass: "bg-violet-100",
        borderClass: "border-slate-200",
        stripeClass: "bg-violet-500",
      };
    case "refund":
      return {
        title: `Refund · $${item.amount?.toLocaleString()}`,
        icon: <Sparkles size={14} className="text-amber-700" />,
        iconBgClass: "bg-amber-100",
        borderClass: "border-slate-200",
        stripeClass: "bg-amber-500",
      };
  }
}

function ActionButton({
  variant,
  onClick,
  icon,
  children,
}: {
  variant: "primary" | "secondary" | "ghost";
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const styles = {
    primary:
      "bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/20 ring-1 ring-emerald-600/20 hover:ring-emerald-600/30",
    secondary:
      "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
    ghost:
      "text-slate-500 hover:bg-rose-50 hover:text-rose-700",
  }[variant];

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 380, damping: 25 }}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[12.5px] font-medium transition-colors ${styles}`}
    >
      {icon}
      {children}
    </motion.button>
  );
}

// =============================================================================
// Analytics Panel
// =============================================================================

function AnalyticsPanel({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <PanelCard title="Operations analytics" subtitle="What the agent did this week">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ChartCard title="Conversation volume" subtitle="Last 7 days · by channel">
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={CONVERSATION_VOLUME} margin={{ top: 10, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(148,163,184,0.18)" vertical={false} />
              <XAxis dataKey="day" stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} width={28} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: "#64748B" }} />
              <Line type="monotone" dataKey="web" stroke="#06B6D4" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reduceMotion} animationDuration={800} />
              <Line type="monotone" dataKey="sms" stroke="#7C3AED" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reduceMotion} animationDuration={900} />
              <Line type="monotone" dataKey="whatsapp" stroke="#10B981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reduceMotion} animationDuration={1000} />
              <Line type="monotone" dataKey="email" stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reduceMotion} animationDuration={1100} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Capture rate" subtitle="% qualified · by channel">
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Tooltip content={<ChartTooltip suffix="% qualified" />} />
              <Pie
                data={CAPTURE_RATE}
                dataKey="value"
                nameKey="channel"
                cx="50%"
                cy="50%"
                innerRadius={42}
                outerRadius={70}
                paddingAngle={3}
                stroke="#ffffff"
                strokeWidth={2}
                isAnimationActive={!reduceMotion}
                animationDuration={900}
              >
                {CAPTURE_RATE.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: "#64748B" }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Conversion funnel" subtitle="This week · vs cohort">
          <ConversionFunnel reduceMotion={reduceMotion} />
        </ChartCard>

        <ChartCard title="HITL response time" subtitle="Your median · seconds">
          <HitlGauge />
        </ChartCard>
      </div>
    </PanelCard>
  );
}

function HitlGauge() {
  const { currentMedianSec, trend, targetSec } = HITL_RESPONSE_TIME;
  const pct = Math.min(100, (currentMedianSec / targetSec) * 100);
  const onTrack = currentMedianSec <= targetSec;
  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-semibold tabular-nums text-slate-900">
          {currentMedianSec}
          <span className="ml-1 text-sm font-normal text-slate-500">sec</span>
        </span>
        <span
          className={`rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wider ${
            onTrack ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {onTrack ? "on target" : "above target"} · {targetSec}s
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          style={{
            background: onTrack
              ? "linear-gradient(90deg, #10B981 0%, #06B6D4 100%)"
              : "linear-gradient(90deg, #F59E0B 0%, #DC2626 100%)",
          }}
        />
      </div>
      <div className="flex items-end gap-1 pt-1">
        {trend.map((v, i) => {
          const max = Math.max(...trend);
          const h = (v / max) * 30 + 4;
          return (
            <motion.div
              key={i}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: h, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.05 * i, ease: "easeOut" }}
              className="w-3 rounded-sm bg-cyan-500/40"
              title={`${v}s`}
            />
          );
        })}
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string | number;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg shadow-slate-900/5">
      {label && <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>}
      <ul className="flex flex-col gap-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-1.5 text-slate-700">
            <span className="size-1.5 rounded-full" style={{ background: p.color }} />
            <span className="capitalize">{p.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-900">{p.value}</span>
          </li>
        ))}
        {suffix && <li className="mt-0.5 text-[10px] text-slate-400">{suffix}</li>}
      </ul>
    </div>
  );
}

// =============================================================================
// Conversion Funnel — horizontal stacked bars with cohort benchmark markers
// =============================================================================

function ConversionFunnel({ reduceMotion }: { reduceMotion: boolean }) {
  const top = FUNNEL_DATA[0]?.value ?? 1;
  const stageColors = ["#06B6D4", "#0EA5E9", "#7C3AED", "#10B981"];

  return (
    <div className="flex flex-col gap-3 px-2 py-1">
      {FUNNEL_DATA.map((stage, i) => {
        const pctOfTop = (stage.value / top) * 100;
        const benchPctOfTop = (stage.benchmark / top) * 100;
        const beatingCohort = stage.value >= stage.benchmark;
        const prev = i > 0 ? FUNNEL_DATA[i - 1] : null;
        const dropPct =
          prev && prev.value > 0
            ? Math.round(((prev.value - stage.value) / prev.value) * 100)
            : null;

        return (
          <div key={stage.stage} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="font-medium text-slate-700">{stage.stage}</span>
              <span className="flex items-center gap-2 text-slate-500">
                {dropPct !== null && (
                  <span className="text-[10px] text-slate-400">
                    −{dropPct}% drop
                  </span>
                )}
                <span className="font-semibold tabular-nums text-slate-900">
                  {stage.value}
                </span>
              </span>
            </div>
            <div className="relative h-5 overflow-hidden rounded-md bg-slate-100">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pctOfTop}%` }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.9, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }
                }
                className="absolute inset-y-0 left-0 rounded-md"
                style={{
                  background: `linear-gradient(90deg, ${stageColors[i] ?? "#06B6D4"} 0%, ${stageColors[i] ?? "#06B6D4"}cc 100%)`,
                }}
              />
              {/* Benchmark tick — cohort average for this stage */}
              <div
                className="absolute inset-y-0 w-px bg-slate-400/70"
                style={{ left: `${Math.min(99, benchPctOfTop)}%` }}
                title={`Cohort benchmark: ${stage.benchmark}`}
              >
                <span className="absolute -top-3 -translate-x-1/2 text-[8px] uppercase tracking-wider text-slate-400">
                  bench
                </span>
              </div>
            </div>
            <div className="text-[10px] text-slate-400">
              vs cohort {stage.benchmark} ·{" "}
              <span
                className={
                  beatingCohort ? "text-emerald-600" : "text-amber-600"
                }
              >
                {beatingCohort ? "ahead" : "behind"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// Knowledge Gaps — questions Denise couldn't answer well
// =============================================================================

function KnowledgeGapsPanel() {
  return (
    <PanelCard
      title="Knowledge gaps"
      subtitle="Questions Denise hit but couldn't fully answer · this week"
      headerRight={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
          <BookOpen className="size-3" />
          {KNOWLEDGE_GAPS.length} to train
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {KNOWLEDGE_GAPS.map((gap, i) => (
          <motion.div
            key={gap.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.35 }}
          >
            <KnowledgeGapCard gap={gap} />
          </motion.div>
        ))}
      </div>
    </PanelCard>
  );
}

function KnowledgeGapCard({ gap }: { gap: KnowledgeGap }) {
  return (
    <article className="group flex h-full flex-col gap-3 rounded-xl border border-slate-200/70 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-md hover:shadow-slate-900/[0.03]">
      <div className="flex items-start gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
          <BookOpen className="size-3.5" />
        </div>
        <p className="text-[13px] leading-snug text-slate-800">
          &ldquo;{gap.question}&rdquo;
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <dt className="uppercase tracking-wider text-slate-400">Topic</dt>
          <dd className="mt-0.5 font-medium text-slate-700">{gap.topic}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-slate-400">Asked</dt>
          <dd className="mt-0.5 font-medium text-slate-700">
            {gap.timesAsked}× ·{" "}
            <span className="text-slate-500">
              last {gap.lastAskedHoursAgo}h ago
            </span>
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-[10px] text-slate-500">
          Source: <span className="text-slate-700">{gap.suggestedSource}</span>
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200/60 transition-colors hover:bg-amber-100"
        >
          <GraduationCap className="size-3" />
          Train her
        </button>
      </div>
    </article>
  );
}

// =============================================================================
// Safety Events Panel — Liga 3 (Lakera / Aporia style)
// PII blocks · injection attempts · hard-rule enforcements · jailbreaks
// =============================================================================

function SafetyEventsPanel() {
  const counters: Array<{
    label: string;
    value: number;
    tone: "rose" | "amber" | "violet" | "slate";
    icon: React.ReactNode;
  }> = [
    {
      label: "PII blocks",
      value: SAFETY_COUNTERS.piiBlocks,
      tone: "rose",
      icon: <Lock className="size-3.5" />,
    },
    {
      label: "Injection attempts",
      value: SAFETY_COUNTERS.injectionAttempts,
      tone: "amber",
      icon: <ShieldX className="size-3.5" />,
    },
    {
      label: "Hard-rule refusals",
      value: SAFETY_COUNTERS.hardRules,
      tone: "violet",
      icon: <ShieldCheck className="size-3.5" />,
    },
    {
      label: "Jailbreak attempts",
      value: SAFETY_COUNTERS.jailbreaks,
      tone: "slate",
      icon: <Shield className="size-3.5" />,
    },
  ];

  const counterTone = {
    rose:   { bg: "bg-rose-50",   text: "text-rose-700",   border: "border-rose-200/60" },
    amber:  { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200/60" },
    violet: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200/60" },
    slate:  { bg: "bg-slate-50",  text: "text-slate-700",  border: "border-slate-200/60" },
  };

  return (
    <PanelCard
      title="Safety events"
      subtitle="What the Trust Stack blocked or refused · this week"
      headerRight={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          <ShieldCheck className="size-3" />
          0 leaks · 0 violations
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counters.map((c, i) => {
          const t = counterTone[c.tone];
          return (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i, duration: 0.3 }}
              className={`flex flex-col gap-1.5 rounded-xl border ${t.border} ${t.bg} p-3`}
            >
              <div className={`flex items-center gap-1.5 ${t.text}`}>
                {c.icon}
                <span className="text-[10px] font-medium uppercase tracking-wider">
                  {c.label}
                </span>
              </div>
              <span className={`text-2xl font-semibold tabular-nums ${t.text}`}>
                {c.value}
              </span>
            </motion.div>
          );
        })}
      </div>

      <ul className="mt-4 flex flex-col divide-y divide-slate-100 border-t border-slate-100">
        {SAFETY_EVENTS.map((ev, i) => (
          <motion.li
            key={ev.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.03 * i, duration: 0.3 }}
          >
            <SafetyEventRow event={ev} />
          </motion.li>
        ))}
      </ul>
    </PanelCard>
  );
}

function SafetyEventRow({ event }: { event: SafetyEvent }) {
  const typeMeta = {
    pii_block: {
      label: "PII BLOCK",
      cls: "bg-rose-100 text-rose-700 ring-rose-200",
      icon: <Lock className="size-3" />,
    },
    injection_attempt: {
      label: "INJECTION",
      cls: "bg-amber-100 text-amber-700 ring-amber-200",
      icon: <ShieldX className="size-3" />,
    },
    hard_rule: {
      label: "HARD RULE",
      cls: "bg-violet-100 text-violet-700 ring-violet-200",
      icon: <ShieldCheck className="size-3" />,
    },
    jailbreak: {
      label: "JAILBREAK",
      cls: "bg-slate-200 text-slate-700 ring-slate-300",
      icon: <Shield className="size-3" />,
    },
  }[event.type];

  return (
    <div className="flex items-start gap-3 py-2.5">
      <span
        className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${typeMeta.cls}`}
      >
        {typeMeta.icon}
        {typeMeta.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-slate-800">
          {event.label}
        </p>
        <p className="text-[11px] leading-snug text-slate-500">{event.detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[10px] text-slate-400">
        <ChannelIcon channel={event.channel} />
        <span className="tabular-nums">
          {event.minutesAgo < 60
            ? `${event.minutesAgo}m`
            : `${Math.floor(event.minutesAgo / 60)}h`}
        </span>
      </div>
    </div>
  );
}

// =============================================================================
// Agenda
// =============================================================================

function AgendaPanel() {
  return (
    <PanelCard title="Today's agenda" subtitle="What's on your calendar">
      <ul className="flex flex-col">
        {TODAY_AGENDA.map((item, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.4 }}
            className="group relative flex items-center gap-3 border-b border-slate-100 py-3 last:border-b-0"
          >
            <div className="flex w-14 shrink-0 flex-col items-center">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">
                {item.time.slice(0, 2)}h
              </span>
              <span className="font-mono text-[13px] tabular-nums text-slate-900">
                {item.time}
              </span>
            </div>
            <div className="h-8 w-px bg-slate-200" aria-hidden />
            <div className="flex flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-medium text-slate-900">{item.customer}</p>
                {item.flag === "hitl" && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-700">
                    <Shield size={9} /> HITL
                  </span>
                )}
              </div>
              <p className="text-[12px] text-slate-600">{item.description}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">
                via {item.source}
              </p>
            </div>
            <ChevronRight size={14} className="text-slate-300 transition-colors group-hover:text-slate-600" />
          </motion.li>
        ))}
      </ul>
    </PanelCard>
  );
}

// =============================================================================
// Live activity timeline
// =============================================================================

function TimelinePanel({
  visitorTrace,
  onOpenTrace,
  onOpenVisitorTrace,
}: {
  visitorTrace: VisitorChatTrace | null;
  onOpenTrace: (m: MessageItem) => void;
  onOpenVisitorTrace: () => void;
}) {
  return (
    <PanelCard
      title="Live activity"
      subtitle="What the agent handled · click any row to replay the trace"
      headerRight={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          <Wifi size={10} />
          Live
        </span>
      }
    >
      {/* Visitor's own session — appears only if they've chatted with the
          landing widget in this browser tab. Pinned at the top. */}
      {visitorTrace?.hasSession && (
        <VisitorTraceCard
          trace={visitorTrace}
          onOpen={onOpenVisitorTrace}
        />
      )}
      <ul className="flex flex-col">
        {RECENT_MESSAGES.map((m, i) => {
          const hasTrace = !!m.trace;
          return (
            <motion.li
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i, duration: 0.35 }}
            >
              <button
                type="button"
                onClick={() => hasTrace && onOpenTrace(m)}
                disabled={!hasTrace}
                className={`group relative flex w-full items-start gap-3 rounded-lg border-b border-slate-100 px-2 py-3 text-left transition-colors last:border-b-0 ${
                  hasTrace
                    ? "hover:bg-slate-50 cursor-pointer"
                    : "cursor-default"
                }`}
              >
                <span className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${getChannelBg(m.channel)}`}>
                  <ChannelIcon channel={m.channel} />
                </span>
                <div className="flex flex-1 flex-col gap-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[13px] font-medium text-slate-900">
                      {m.customer}
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400">
                        {m.vertical}
                      </span>
                    </p>
                    <span className="font-mono text-[10px] tabular-nums text-slate-400">
                      {m.timeLabel}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-slate-600">{m.preview}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <OutcomeChip outcome={m.outcome} />
                    {hasTrace && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-cyan-700 opacity-0 transition-opacity group-hover:opacity-100">
                        View trace
                        <ChevronRight size={10} />
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </motion.li>
          );
        })}
      </ul>
    </PanelCard>
  );
}

function VisitorTraceCard({
  trace,
  onOpen,
}: {
  trace: VisitorChatTrace;
  onOpen: () => void;
}) {
  if (!trace.hasSession) return null;
  const hasTurn = trace.rowCount > 0 && trace.latestTurn != null;
  const isDeny = hasTurn && trace.latestTurn!.decision === "DENY";

  return (
    <div className="mb-3">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={`relative overflow-hidden rounded-xl border ${
          isDeny ? "border-rose-200" : "border-cyan-200"
        } ${isDeny ? "bg-gradient-to-r from-rose-50 to-white" : "bg-gradient-to-r from-cyan-50 to-white"} p-4`}
      >
        <div
          aria-hidden
          className="absolute -right-8 -top-8 size-32 rounded-full blur-2xl"
          style={{
            background: isDeny
              ? "radial-gradient(circle, rgba(244,63,94,0.18), transparent 70%)"
              : "radial-gradient(circle, rgba(6,182,212,0.20), transparent 70%)",
          }}
        />
        <div className="relative flex items-start gap-3">
          <span
            className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${
              isDeny ? "bg-rose-100 text-rose-700" : "bg-cyan-100 text-cyan-700"
            }`}
            aria-hidden
          >
            <Sparkles size={16} />
          </span>
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-slate-900">
                Your chat with our landing assistant
              </p>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  isDeny
                    ? "bg-rose-100 text-rose-700"
                    : "bg-cyan-100 text-cyan-700"
                }`}
              >
                Live · real data
              </span>
            </div>
            {hasTurn ? (
              <>
                <p className="text-[12.5px] text-slate-600">
                  {trace.latestTurn!.summary}
                </p>
                <p className="text-[11px] text-slate-500">
                  {trace.rowCount} event{trace.rowCount === 1 ? "" : "s"} in your
                  audit chain · click to replay the latest turn
                </p>
              </>
            ) : (
              <>
                <p className="text-[12.5px] text-slate-600">
                  You have a session open but no messages yet.
                </p>
                <p className="text-[11px] text-slate-500">
                  Open the chat widget at the bottom-right and send a message,
                  then refresh this page to see your real trace.
                </p>
              </>
            )}
          </div>
          {hasTurn && (
            <button
              type="button"
              onClick={onOpen}
              className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium shadow-sm transition-colors ${
                isDeny
                  ? "border-rose-300 bg-white text-rose-700 hover:bg-rose-50"
                  : "border-cyan-300 bg-white text-cyan-700 hover:bg-cyan-50"
              }`}
            >
              Replay trace
              <ChevronRight size={11} />
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function getChannelBg(channel: MessageItem["channel"]): string {
  return {
    sms: "bg-violet-100",
    email: "bg-amber-100",
    whatsapp: "bg-emerald-100",
    web: "bg-cyan-100",
    voice: "bg-rose-100",
  }[channel];
}

function ChannelIcon({ channel }: { channel: MessageItem["channel"] }) {
  const map = {
    sms: { icon: <MessageSquare size={13} />, cls: "text-violet-700" },
    email: { icon: <Mail size={13} />, cls: "text-amber-700" },
    whatsapp: { icon: <MessageCircle size={13} />, cls: "text-emerald-700" },
    web: { icon: <Globe size={13} />, cls: "text-cyan-700" },
    voice: { icon: <Phone size={13} />, cls: "text-rose-700" },
  } as const;
  const { icon, cls } = map[channel];
  return <span className={cls}>{icon}</span>;
}

function OutcomeChip({ outcome }: { outcome: MessageItem["outcome"] }) {
  const map = {
    qualified: { label: "Qualified", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
    booked: { label: "Booked", cls: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200" },
    escalated: { label: "Escalated", cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
    drafted: { label: "Reply drafted", cls: "bg-violet-50 text-violet-700 ring-1 ring-violet-200" },
    answered: { label: "Answered", cls: "bg-slate-100 text-slate-700" },
  } as const;
  const { label, cls } = map[outcome];
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}>
      {label}
    </span>
  );
}

// =============================================================================
// Audit summary
// =============================================================================

function AuditPanel() {
  const [secondsAgo, setSecondsAgo] = useState(
    AUDIT_SUMMARY.lastVerifiedSecondsAgo,
  );

  useEffect(() => {
    // Ticking "last verified Ns ago" — re-verifies the hash chain every ~60s
    const id = setInterval(() => {
      setSecondsAgo((s) => (s >= 59 ? 0 : s + 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-cyan-200/70 bg-gradient-to-r from-cyan-50/60 to-white p-4 shadow-sm">
      <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700">
            <Shield size={16} />
          </span>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Trust Stack · append-only audit chain
            </p>
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">
                {AUDIT_SUMMARY.chainRowCount.toLocaleString()}
              </span>{" "}
              rows ·{" "}
              <span className="font-semibold text-slate-900">
                {AUDIT_SUMMARY.eventsThisWeek}
              </span>{" "}
              events this week
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Integrity badge — the receipt for "we logged it" */}
          <div
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200/70 bg-emerald-50/80 px-2.5 py-1.5"
            title="Each audit row chains a SHA-256 hash of the previous row. Tampering with any row breaks the chain on the next verification."
          >
            <span className="relative inline-flex size-2" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800">
                <Check size={11} />
                Hash chain verified
              </span>
              <span className="font-mono text-[10px] text-emerald-700/80">
                …{AUDIT_SUMMARY.lastChainHash.slice(-12)} · {secondsAgo}s ago
              </span>
            </div>
          </div>

          <Link
            href="/demo/audit"
            className="inline-flex items-center gap-1 rounded-md border border-cyan-300 bg-white px-3 py-1.5 text-xs font-medium text-cyan-700 shadow-sm transition-colors hover:border-cyan-400 hover:bg-cyan-50"
          >
            View full audit trail
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Settings drawer
// =============================================================================

function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", bounce: 0.15, duration: 0.55 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-cyan-700">Settings</p>
                <h2 className="text-base font-semibold text-slate-900">How the agent operates</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close settings"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5 text-sm">
              <SettingRow label="Business hours">{SETTINGS.businessHours}</SettingRow>
              <SettingRow label="Approval thresholds">
                <ul className="mt-1 space-y-1 text-[13px] text-slate-700">
                  {SETTINGS.approvalThresholds.map((t, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="size-1 rounded-full bg-cyan-500" />
                      {t}
                    </li>
                  ))}
                </ul>
              </SettingRow>
              <SettingRow label="HITL routing">{SETTINGS.hitlRouting}</SettingRow>
              <SettingRow label="Agent tone">{SETTINGS.tone}</SettingRow>
              <SettingRow label="Knowledge sync">
                <ul className="mt-1 space-y-1.5 text-[13px]">
                  {SETTINGS.knowledgeSync.map((k) => (
                    <li key={k.name} className="flex items-center justify-between">
                      <span className="text-slate-700">{k.name}</span>
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
                        <span className={`size-1.5 rounded-full ${k.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
                        {k.ok ? `synced ${k.lastSyncMinutes}m ago` : "error"}
                      </span>
                    </li>
                  ))}
                </ul>
              </SettingRow>
            </div>
            <div className="border-t border-slate-200 p-4">
              <p className="text-center text-[10px] uppercase tracking-wider text-slate-400">
                Settings demo · changes don&apos;t persist
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <div className="text-slate-700">{children}</div>
    </div>
  );
}

// =============================================================================
// Agent Identity Card
// =============================================================================

function AgentIdentityCard() {
  return (
    <article className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      {/* Soft brand glow behind the avatar */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-12 -top-12 size-44 rounded-full opacity-60 blur-2xl"
        style={{
          background:
            "radial-gradient(circle, rgba(124,58,237,0.25), transparent 70%)",
        }}
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Avatar */}
        <div className="flex shrink-0 items-center gap-4">
          <div
            className="relative inline-flex size-14 items-center justify-center rounded-2xl text-lg font-semibold text-white ring-2 ring-white"
            style={{
              background:
                "radial-gradient(circle at 35% 35%, #A78BFA 0%, #7C3AED 45%, #06B6D4 100%)",
              boxShadow:
                "0 10px 30px -10px rgba(124,58,237,0.45), 0 0 0 1px rgba(124,58,237,0.15)",
            }}
            aria-hidden
          >
            {AGENT.name.charAt(0)}
            <span className="absolute -bottom-0.5 -right-0.5 inline-flex size-3.5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
              <span className="size-1.5 rounded-full bg-emerald-200" />
            </span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                {AGENT.name}
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
                <span className="size-1 rounded-full bg-emerald-500" />
                {AGENT.status}
              </span>
            </div>
            <p className="text-[13px] text-slate-600">{AGENT.role}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden h-12 w-px bg-slate-200 sm:block" aria-hidden />

        {/* Stats grid */}
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 sm:gap-x-8">
          <Stat label="Version" value={AGENT.versionTag} mono />
          <Stat label="Trust Stack" value={AGENT.trustStackVersion} mono />
          <Stat
            label="Trained on"
            value={`${AGENT.conversationsTrained.toLocaleString()} convs`}
          />
          <Stat label="Active since" value={AGENT.uptime} />
        </div>

        {/* CTA */}
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 shadow-sm transition-colors hover:border-cyan-300 hover:text-cyan-700"
        >
          Configure
          <ArrowUpRight size={13} />
        </button>
      </div>
      <p className="relative mt-3 border-t border-slate-100 pt-2.5 text-[11px] text-slate-400">
        Last reviewed {AGENT.lastUpdated} · governance retainer keeps Denise tuned
      </p>
    </article>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p
        className={`text-[13px] font-medium text-slate-900 ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// =============================================================================
// Integrations Panel
// =============================================================================

function IntegrationsPanel() {
  return (
    <PanelCard
      title="Integrations"
      subtitle="Denise reads + writes to these tools · all on your accounts"
      headerRight={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          <span className="size-1 rounded-full bg-emerald-500" />
          {INTEGRATIONS.filter((i) => i.status === "connected").length}/
          {INTEGRATIONS.length} healthy
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((it, i) => (
          <motion.div
            key={it.name}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * i, duration: 0.35 }}
          >
            <IntegrationCard integration={it} />
          </motion.div>
        ))}
      </div>
    </PanelCard>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const tintMap = {
    cyan: { bg: "bg-cyan-100", text: "text-cyan-700", border: "border-cyan-200/60" },
    violet: { bg: "bg-violet-100", text: "text-violet-700", border: "border-violet-200/60" },
    emerald: { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200/60" },
    amber: { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-200/60" },
    rose: { bg: "bg-rose-100", text: "text-rose-700", border: "border-rose-200/60" },
    sky: { bg: "bg-sky-100", text: "text-sky-700", border: "border-sky-200/60" },
  }[integration.tint];

  const statusMap = {
    connected: { label: "Connected", cls: "text-emerald-700 bg-emerald-50 ring-emerald-200", dot: "bg-emerald-500" },
    syncing: { label: "Syncing", cls: "text-amber-700 bg-amber-50 ring-amber-200", dot: "bg-amber-500" },
    error: { label: "Error", cls: "text-rose-700 bg-rose-50 ring-rose-200", dot: "bg-rose-500" },
  }[integration.status];

  return (
    <article
      className={`group flex flex-col gap-3 rounded-xl border ${tintMap.border} bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-slate-900/[0.03]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`inline-flex size-9 items-center justify-center rounded-lg ${tintMap.bg} ${tintMap.text} text-base font-semibold`}
            aria-hidden
          >
            {integration.initials}
          </div>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">
              {integration.name}
            </p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              {integration.category}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${statusMap.cls}`}
        >
          {integration.status === "syncing" ? (
            <span className="relative inline-flex size-1.5">
              <span className={`absolute inset-0 animate-ping rounded-full ${statusMap.dot} opacity-70`} />
              <span className={`relative inline-flex size-1.5 rounded-full ${statusMap.dot}`} />
            </span>
          ) : (
            <span className={`size-1 rounded-full ${statusMap.dot}`} />
          )}
          {statusMap.label}
        </span>
      </div>
      <p className="text-[12px] text-slate-600">{integration.description}</p>
      <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px]">
        <span className="font-mono text-slate-500">
          {integration.lastSyncMin === 0
            ? "syncing now"
            : `synced ${integration.lastSyncMin}m ago`}
        </span>
        <span className="text-slate-500">
          <span className="font-semibold tabular-nums text-slate-900">
            {integration.callsLast24h}
          </span>{" "}
          calls / 24h
        </span>
      </div>
    </article>
  );
}

// =============================================================================
// Trace Drawer — the WOW of the Trust Stack
// =============================================================================

function TraceDrawer({ open, onClose }: { open: TraceOpen; onClose: () => void }) {
  const total = open?.trace.reduce((sum, s) => sum + s.durationMs, 0) ?? 0;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", bounce: 0.15, duration: 0.55 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-gradient-to-br from-white via-white to-cyan-50/30"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-cyan-700">
                  Trust Stack · trace replay
                </p>
                <h2 className="text-base font-semibold text-slate-900">
                  {open.customer}
                </h2>
                <p className="font-mono text-[11px] text-slate-500">
                  via {open.channel.toUpperCase()} · {open.trace.length} steps ·{" "}
                  {(total / 1000).toFixed(2)}s total
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close trace"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={16} />
              </button>
            </div>

            {/* Steps */}
            <div className="flex-1 overflow-y-auto p-5">
              <ol className="relative space-y-2">
                {/* Vertical timeline rail */}
                <span
                  aria-hidden
                  className="absolute left-[15px] top-2 h-[calc(100%-1.5rem)] w-px bg-gradient-to-b from-cyan-300 via-slate-200 to-violet-300"
                />
                {open.trace.map((step, i) => (
                  <TraceStepRow key={i} step={step} index={i + 1} />
                ))}
              </ol>
            </div>

            {/* Footer — links to full audit */}
            <div className="border-t border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500">
                  Every step above is{" "}
                  <span className="font-semibold text-slate-700">
                    immutably logged
                  </span>{" "}
                  in the audit chain.
                </p>
                <Link
                  href="/demo/audit"
                  className="inline-flex items-center gap-1 rounded-md border border-cyan-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-cyan-700 shadow-sm hover:bg-cyan-50"
                >
                  See full audit
                  <ArrowUpRight size={11} />
                </Link>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function TraceStepRow({ step, index }: { step: TraceStep; index: number }) {
  const meta = getTraceMeta(step);
  return (
    <motion.li
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.035 * index, duration: 0.35 }}
      className="relative flex gap-3 pl-1"
    >
      {/* Dot on the timeline */}
      <div className="relative z-10 flex shrink-0">
        <span
          className={`inline-flex size-[31px] items-center justify-center rounded-full ring-4 ring-white ${meta.dotBg}`}
        >
          <span className={`text-[10px] font-semibold ${meta.dotText}`}>
            {String(index).padStart(2, "0")}
          </span>
        </span>
      </div>
      {/* Card */}
      <div
        className={`flex-1 rounded-lg border ${meta.border} bg-white p-3 shadow-sm`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${meta.layerChip}`}
            >
              {meta.layerLabel}
            </span>
            <p className="text-[13px] font-medium text-slate-900">
              {step.label}
            </p>
          </div>
          <span className="font-mono text-[10px] text-slate-400">
            {step.durationMs}ms
          </span>
        </div>
        <p className="mt-1 text-[12px] text-slate-600">{step.detail}</p>
        {step.result && (
          <p
            className={`mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${meta.resultChip}`}
          >
            <Check size={10} />
            {step.result}
          </p>
        )}
      </div>
    </motion.li>
  );
}

function getTraceMeta(step: TraceStep) {
  const layerMap: Record<
    TraceStep["layer"],
    { layerLabel: string; layerChip: string; dotBg: string; dotText: string; border: string }
  > = {
    webhook: {
      layerLabel: "Channel",
      layerChip: "bg-sky-100 text-sky-700",
      dotBg: "bg-sky-500",
      dotText: "text-white",
      border: "border-sky-200",
    },
    rate_limit: {
      layerLabel: "Guard",
      layerChip: "bg-slate-100 text-slate-700",
      dotBg: "bg-slate-500",
      dotText: "text-white",
      border: "border-slate-200",
    },
    dlp_l1: {
      layerLabel: "DLP L1",
      layerChip: "bg-cyan-100 text-cyan-700",
      dotBg: "bg-cyan-500",
      dotText: "text-white",
      border: "border-cyan-200",
    },
    dlp_l2: {
      layerLabel: "DLP L2",
      layerChip: "bg-cyan-100 text-cyan-700",
      dotBg: "bg-cyan-600",
      dotText: "text-white",
      border: "border-cyan-200",
    },
    intent: {
      layerLabel: "Routing",
      layerChip: "bg-slate-100 text-slate-700",
      dotBg: "bg-slate-500",
      dotText: "text-white",
      border: "border-slate-200",
    },
    rbac: {
      layerLabel: "RBAC",
      layerChip: "bg-violet-100 text-violet-700",
      dotBg: "bg-violet-500",
      dotText: "text-white",
      border: "border-violet-200",
    },
    rag: {
      layerLabel: "Knowledge",
      layerChip: "bg-amber-100 text-amber-700",
      dotBg: "bg-amber-500",
      dotText: "text-white",
      border: "border-amber-200",
    },
    agent: {
      layerLabel: "Agent",
      layerChip: "bg-fuchsia-100 text-fuchsia-700",
      dotBg: "bg-fuchsia-500",
      dotText: "text-white",
      border: "border-fuchsia-200",
    },
    tool: {
      layerLabel: "Tool",
      layerChip: "bg-emerald-100 text-emerald-700",
      dotBg: "bg-emerald-500",
      dotText: "text-white",
      border: "border-emerald-200",
    },
    hitl: {
      layerLabel: "HITL",
      layerChip: "bg-rose-100 text-rose-700",
      dotBg: "bg-rose-400",
      dotText: "text-white",
      border: "border-rose-200",
    },
    audit: {
      layerLabel: "Audit",
      layerChip: "bg-violet-100 text-violet-700",
      dotBg: "bg-violet-600",
      dotText: "text-white",
      border: "border-violet-200",
    },
    response: {
      layerLabel: "Reply",
      layerChip: "bg-sky-100 text-sky-700",
      dotBg: "bg-sky-600",
      dotText: "text-white",
      border: "border-sky-200",
    },
  };
  const m = layerMap[step.layer];
  const resultChip =
    step.status === "blocked"
      ? "bg-rose-50 text-rose-700"
      : step.status === "skipped"
        ? "bg-slate-100 text-slate-600"
        : "bg-emerald-50 text-emerald-700";
  return { ...m, resultChip };
}

// =============================================================================
// Shared cards + toast
// =============================================================================

function PanelCard({
  title,
  subtitle,
  children,
  headerRight,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-slate-500">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      {children}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-3.5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[12px] font-medium text-slate-800">{title}</h3>
        {subtitle && <p className="text-[10px] uppercase tracking-wider text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function ToastView({ toast }: { toast: ToastState }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ y: 30, opacity: 0, scale: 0.92 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", bounce: 0.25, duration: 0.55 }}
          className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-700 shadow-lg shadow-emerald-500/10">
            <Check size={14} className="text-emerald-600" />
            {toast.label}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
