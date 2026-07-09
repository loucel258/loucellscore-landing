import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { sendEmail, verifyCronAuth } from "@/lib/notify/resend";
import { resolveAlertInbox } from "@/lib/admin/settings";
import { logCronRun } from "@/lib/ops/cron-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel cron: business-pulse
 * Schedule: daily at 01:00 UTC (~21:00 ET summer) — configured in vercel.json.
 * (Same winter caveat as the morning brief: EST shifts this to 20:00 ET.)
 *
 * A nightly digest to Steven — the dashboard without opening the dashboard.
 * Spec: 00-Sistema-Operativo/4-cadencia/specs/business-pulse.md
 *
 * Governance:
 *   - ALL queries read-only, service client, server-side. Keys never leave
 *     Vercel (L3/L4).
 *   - Content = aggregated metrics only. Never transcripts, never PII. We
 *     COUNT conversation_messages rows (ciphertext) — we never decrypt them.
 *   - It's a report to the owner (Steven), not outbound comms to a third
 *     party → does not violate L0.
 *   - Each section fetches defensively: a schema surprise degrades that one
 *     section to "—" instead of crashing the digest.
 *
 * Fails closed:
 *   - No CRON_SECRET in prod → 401 (rejects non-Vercel callers).
 *   - No RESEND_API_KEY → runs, logs, but sends nothing (skipped:no_resend).
 *   - No Supabase service client → skipped:no_supabase.
 */

// Windows are rolling (TZ-independent): "today" = last 24h, "7d avg" = last
// 7 days / 7. Honest and DST-proof for a 21:00 ET nightly send.
const DAY_MS = 86400_000;
const AGENT_ERROR_CAUSES = ["service_unavailable", "upstream_error"];
const ROW_CAP = 10000; // safety cap on the messages scan

// Friendly labels for known workspaces (falls back to the raw id).
const WS_LABELS: Record<string, string> = {
  ws_chat_loucel_landing: "Landing (loucellscore.com)",
};

type CronRunLite = { job: string; status: string; summary: string | null; ran_at: string };
type ApprovalLite = {
  id: string;
  created_at: string;
  action_type: string;
  workspace_id: string;
};
type AgentLite = {
  name: string;
  slug: string | null;
  workspace_id: string;
  status: string;
  retainer_active: boolean | null;
};

export async function GET(req: Request): Promise<Response> {
  return handleCron(req);
}
export async function POST(req: Request): Promise<Response> {
  return handleCron(req);
}

async function handleCron(req: Request): Promise<Response> {
  if (!verifyCronAuth(req)) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!process.env.RESEND_API_KEY) {
    await logCronRun({ job: "business-pulse", status: "skipped", summary: "no_resend" });
    return NextResponse.json({ ok: true, skipped: "no_resend" });
  }
  const sb = getServiceClient();
  if (!sb) {
    await logCronRun({ job: "business-pulse", status: "skipped", summary: "no_supabase" });
    return NextResponse.json({ ok: true, skipped: "no_supabase" });
  }

  const startedAt = Date.now();
  const now = new Date();
  const since24h = new Date(now.getTime() - DAY_MS).toISOString();
  const since7d = new Date(now.getTime() - 7 * DAY_MS).toISOString();

  // Run every section defensively and in parallel.
  const [conv, agents, crons, approvals, funnel] = await Promise.all([
    getConversations(sb, since24h, since7d),
    getAgents(sb, since24h),
    getCrons(sb, since24h),
    getApprovals(sb),
    getFunnel(sb, since24h),
  ]);

  // ── anomalies ────────────────────────────────────────────────────
  const anomalies: string[] = [];
  for (const w of conv.rows) {
    if (w.avg7d >= 3 && (w.today > w.avg7d * 2 || w.today < w.avg7d * 0.5)) {
      anomalies.push(
        `${w.label}: ${w.today} msgs hoy vs ${w.avg7d.toFixed(1)}/día promedio (${w.today > w.avg7d ? "▲" : "▼"} >2x)`,
      );
    }
  }
  const failedCrons = crons.rows.filter((c) => c.status === "error");
  if (failedCrons.length) anomalies.push(`${failedCrons.length} cron(s) fallaron hoy`);
  if (agents.errorsTotal > 0) anomalies.push(`${agents.errorsTotal} error(es) de agente hoy`);

  const hasProblem = failedCrons.length > 0 || agents.errorsTotal > 0;
  const dateLabel = now.toLocaleDateString("es-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

  const html = renderHtml({ conv, agents, crons, approvals, funnel, anomalies, dateLabel });
  const to = process.env.ADMIN_EMAIL?.trim() || (await resolveAlertInbox());
  const subject = `${hasProblem ? "🔴 " : "📊 "}Business Pulse — ${dateLabel}`;

  const send = await sendEmail({ to, subject, html });

  const summary = `conv:${conv.rows.length}ws agents:${agents.list.length} crons:${crons.rows.length}(${failedCrons.length}✗) approvals:${approvals.length} anomalies:${anomalies.length} sent:${send.ok}`;
  await logCronRun({
    job: "business-pulse",
    status: send.ok ? "ok" : "error",
    summary,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({ ok: true, sent: send.ok, summary });
}

/* ─────────────────────────── section fetchers ─────────────────────────── */

async function getConversations(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  since24h: string,
  since7d: string,
): Promise<{ rows: { workspace_id: string; label: string; today: number; avg7d: number }[]; capped: boolean; ok: boolean }> {
  try {
    const { data, error } = await sb
      .from("conversation_messages")
      .select("workspace_id, inserted_at")
      .eq("role", "user")
      .gte("inserted_at", since7d)
      .order("inserted_at", { ascending: false })
      .limit(ROW_CAP);
    if (error) return { rows: [], capped: false, ok: false };
    const rows = (data as { workspace_id: string; inserted_at: string }[] | null) ?? [];
    const agg = new Map<string, { today: number; week: number }>();
    for (const r of rows) {
      const a = agg.get(r.workspace_id) ?? { today: 0, week: 0 };
      a.week += 1;
      if (r.inserted_at >= since24h) a.today += 1;
      agg.set(r.workspace_id, a);
    }
    const out = [...agg.entries()]
      .map(([workspace_id, v]) => ({
        workspace_id,
        label: WS_LABELS[workspace_id] ?? workspace_id,
        today: v.today,
        avg7d: v.week / 7,
      }))
      .sort((a, b) => b.today - a.today);
    return { rows: out, capped: rows.length >= ROW_CAP, ok: true };
  } catch {
    return { rows: [], capped: false, ok: false };
  }
}

async function getAgents(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  since24h: string,
): Promise<{ list: AgentLite[]; errorsByWs: Map<string, number>; errorsTotal: number; ok: boolean }> {
  const errorsByWs = new Map<string, number>();
  let list: AgentLite[] = [];
  let ok = true;
  try {
    const { data } = await sb
      .from("client_agents")
      .select("name, slug, workspace_id, status, retainer_active")
      .in("status", ["live", "uat", "shadow_mode", "paused"]);
    list = (data as AgentLite[] | null) ?? [];
  } catch {
    ok = false;
  }
  try {
    const { data } = await sb
      .from("audit_logs")
      .select("workspace_id")
      .in("blocked_by", AGENT_ERROR_CAUSES)
      .gte("inserted_at", since24h)
      .limit(500);
    for (const r of (data as { workspace_id: string }[] | null) ?? []) {
      errorsByWs.set(r.workspace_id, (errorsByWs.get(r.workspace_id) ?? 0) + 1);
    }
  } catch {
    /* errors are best-effort */
  }
  let errorsTotal = 0;
  for (const n of errorsByWs.values()) errorsTotal += n;
  return { list, errorsByWs, errorsTotal, ok };
}

async function getCrons(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  since24h: string,
): Promise<{ rows: CronRunLite[]; ok: boolean }> {
  try {
    const { data, error } = await sb
      .from("cron_runs")
      .select("job, status, summary, ran_at")
      .gte("ran_at", since24h)
      .order("ran_at", { ascending: false })
      .limit(200);
    if (error) return { rows: [], ok: false };
    // latest run per job today
    const seen = new Set<string>();
    const rows: CronRunLite[] = [];
    for (const r of (data as CronRunLite[] | null) ?? []) {
      if (seen.has(r.job)) continue;
      seen.add(r.job);
      rows.push(r);
    }
    // failed first
    rows.sort((a, b) => (a.status === "error" ? -1 : 0) - (b.status === "error" ? -1 : 0));
    return { rows, ok: true };
  } catch {
    return { rows: [], ok: false };
  }
}

async function getApprovals(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
): Promise<ApprovalLite[]> {
  try {
    const { data } = await sb
      .from("pending_approvals")
      .select("id, created_at, action_type, workspace_id")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);
    return (data as ApprovalLite[] | null) ?? [];
  } catch {
    return [];
  }
}

async function getFunnel(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  since24h: string,
): Promise<{ subs: number; leads: number; booked: number; appts: number | null }> {
  let subs = 0;
  let leads = 0;
  let booked = 0;
  let appts: number | null = null;
  try {
    const { count } = await sb
      .from("subscribers")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since24h);
    subs = count ?? 0;
  } catch {
    /* ignore */
  }
  try {
    const { data } = await sb
      .from("leads")
      .select("id, booking_slot_iso, created_at")
      .gte("created_at", since24h)
      .limit(200);
    const rows = (data as { booking_slot_iso: string | null }[] | null) ?? [];
    leads = rows.length;
    booked = rows.filter((r) => r.booking_slot_iso).length;
  } catch {
    /* ignore */
  }
  try {
    const { count } = await sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since24h);
    appts = count ?? 0;
  } catch {
    appts = null; // table/column not as expected — hide the row
  }
  return { subs, leads, booked, appts };
}

/* ─────────────────────────────── render ──────────────────────────────── */

function ageLabel(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600_000);
  if (h < 1) return "<1h";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderHtml(d: {
  conv: Awaited<ReturnType<typeof getConversations>>;
  agents: Awaited<ReturnType<typeof getAgents>>;
  crons: Awaited<ReturnType<typeof getCrons>>;
  approvals: ApprovalLite[];
  funnel: Awaited<ReturnType<typeof getFunnel>>;
  anomalies: string[];
  dateLabel: string;
}): string {
  const { conv, agents, crons, approvals, funnel, anomalies, dateLabel } = d;
  const card = "background:#ffffff;border:1px solid #e6e8ee;border-radius:12px;padding:16px 18px;margin:0 0 12px";
  const h2 = "margin:0 0 10px;font-size:13px;font-weight:700;color:#0f172a";
  const muted = "color:#64748b";
  const row = "font-size:13px;color:#0f172a;padding:5px 0;border-bottom:1px solid #f1f5f9";

  // 1. Conversaciones
  const convBody = conv.rows.length
    ? conv.rows
        .map((w) => {
          const delta =
            w.avg7d > 0
              ? ` <span style="${muted};font-size:12px">vs ${w.avg7d.toFixed(1)}/día prom.</span>`
              : ` <span style="${muted};font-size:12px">(sin histórico)</span>`;
          return `<div style="${row}"><strong>${esc(w.label)}</strong> — ${w.today} msgs hoy${delta}</div>`;
        })
        .join("")
    : `<div style="${muted};font-size:13px">Sin mensajes en las últimas 24h.${conv.ok ? "" : " (query no disponible)"}</div>`;

  // 2. Agentes
  const statusDot = (s: string) =>
    s === "live" ? "🟢" : s === "paused" ? "⏸️" : s === "archived" ? "⚪" : "🟡";
  const agentsBody = agents.list.length
    ? agents.list
        .map((a) => {
          const errs = agents.errorsByWs.get(a.workspace_id) ?? 0;
          const errTag = errs
            ? ` <span style="color:#dc2626;font-size:12px">· ${errs} error(es) hoy</span>`
            : "";
          return `<div style="${row}">${statusDot(a.status)} <strong>${esc(a.name)}</strong> <span style="${muted};font-size:12px">${esc(a.status)}${a.slug ? ` · /${esc(a.slug)}` : ""}</span>${errTag}</div>`;
        })
        .join("")
    : `<div style="${muted};font-size:13px">Sin agentes activos.${agents.ok ? "" : " (query no disponible)"}</div>`;

  // 3. Crons
  const cronsBody = crons.rows.length
    ? crons.rows
        .map((c) => {
          const icon = c.status === "error" ? "🔴" : c.status === "skipped" ? "⚪" : "🟢";
          return `<div style="${row}">${icon} <strong>${esc(c.job)}</strong> <span style="${muted};font-size:12px">${esc(c.summary ?? c.status)}</span></div>`;
        })
        .join("")
    : `<div style="${muted};font-size:13px">Ningún cron registró corrida en 24h.${crons.ok ? "" : " (query no disponible)"}</div>`;

  // 4. Approvals
  const apprBody = approvals.length
    ? approvals
        .map(
          (a) =>
            `<div style="${row}"><strong>${esc(a.action_type)}</strong> <span style="${muted};font-size:12px">${esc(WS_LABELS[a.workspace_id] ?? a.workspace_id)} · esperando ${ageLabel(a.created_at)}</span></div>`,
        )
        .join("")
    : `<div style="${muted};font-size:13px">✅ Sin aprobaciones pendientes.</div>`;

  // 5. Funnel
  const funnelRows = [
    `<div style="${row}"><strong>${funnel.subs}</strong> suscriptor(es) nuevos <span style="${muted};font-size:12px">(checklist)</span></div>`,
    `<div style="${row}"><strong>${funnel.leads}</strong> lead(s) nuevos <span style="${muted};font-size:12px">· ${funnel.booked} con slot reservado</span></div>`,
  ];
  if (funnel.appts !== null) {
    funnelRows.push(`<div style="${row}"><strong>${funnel.appts}</strong> cita(s) creadas hoy</div>`);
  }

  // 6. Anomalías (only when present)
  const anomBlock = anomalies.length
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px 18px;margin:0 0 12px">
         <h2 style="${h2};color:#b91c1c">⚠️ Anomalías</h2>
         ${anomalies.map((a) => `<div style="font-size:13px;color:#7f1d1d;padding:4px 0">• ${esc(a)}</div>`).join("")}
       </div>`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <div style="margin:0 0 16px">
      <div style="font-size:18px;font-weight:800;color:#0f172a">📊 Business Pulse</div>
      <div style="${muted};font-size:13px;margin-top:2px">${esc(dateLabel)} · el pulso del negocio en 60 segundos</div>
    </div>
    ${anomBlock}
    <div style="${card}"><h2 style="${h2}">💬 Conversaciones</h2>${convBody}</div>
    <div style="${card}"><h2 style="${h2}">🤖 Agentes</h2>${agentsBody}</div>
    <div style="${card}"><h2 style="${h2}">⏰ Crons (24h)</h2>${cronsBody}</div>
    <div style="${card}"><h2 style="${h2}">✅ Aprobaciones pendientes</h2>${apprBody}</div>
    <div style="${card}"><h2 style="${h2}">📈 Funnel (24h)</h2>${funnelRows.join("")}</div>
    <div style="${muted};font-size:11px;text-align:center;margin-top:8px;line-height:1.5">
      100% métricas agregadas · nunca transcripts ni PII · read-only<br>
      Loucells Core · Business Pulse · <a href="https://loucellscore.com/admin/chat-pulse" style="color:#64748b">admin/chat-pulse</a>
    </div>
  </div>
</body></html>`;
}
