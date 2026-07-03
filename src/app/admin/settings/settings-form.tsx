"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ShieldCheck, Wallet, Check, AlertTriangle, KeyRound, Send, Clock } from "lucide-react";
import type { AdminSettings } from "@/lib/admin/settings";

const card =
  "rounded-2xl border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 p-5";
const input =
  "w-full rounded-lg border border-neutral-300 bg-white/70 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none";
const label = "block text-xs font-medium text-neutral-600 mb-1";

function Toggle({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-lg border border-white/60 bg-white/40 px-3 py-2.5 text-left transition-colors hover:bg-white/60"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-neutral-800">{title}</span>
        <span className="block text-xs text-neutral-500">{hint}</span>
      </span>
      <span
        aria-checked={checked}
        role="switch"
        className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-cyan-600" : "bg-neutral-300"
        }`}
      >
        <span
          className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

export function SettingsForm({ initial }: { initial: AdminSettings }) {
  const router = useRouter();

  const [alertInbox, setAlertInbox] = useState(initial.alertInbox ?? "");
  const [alertsEnabled, setAlertsEnabled] = useState(initial.alertsEnabled);
  const [alertOnPii, setAlertOnPii] = useState(initial.alertOnPii);
  const [alertOnBudget, setAlertOnBudget] = useState(initial.alertOnBudget);
  const [noLeadsHours, setNoLeadsHours] = useState(initial.alertNoLeadsHours);
  const [sessionHours, setSessionHours] = useState(initial.sessionTtlHours);
  const [defaultBudget, setDefaultBudget] = useState(initial.defaultMonthlyBudget);
  const [budgetPct, setBudgetPct] = useState(Math.round(initial.budgetAlertPct * 100));
  const [bhStart, setBhStart] = useState(initial.businessHoursStart);
  const [bhEnd, setBhEnd] = useState(initial.businessHoursEnd);
  const [timezone, setTimezone] = useState(initial.businessTimezone);
  const [retentionDays, setRetentionDays] = useState(initial.defaultRetentionDays);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function sendTestAlert() {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/admin/settings/test-alert", { method: "POST" });
      const d = await res.json();
      if (d.ok) {
        setTestMsg({ ok: true, text: "Test alert sent — check the inbox." });
      } else {
        const why =
          d.reason === "no_api_key"
            ? "RESEND_API_KEY not set in Vercel."
            : d.reason === "alerts_disabled"
              ? "Master switch is off (save it on first)."
              : "Send failed — check the inbox address.";
        setTestMsg({ ok: false, text: why });
      }
    } catch {
      setTestMsg({ ok: false, text: "Network error." });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alert_inbox: alertInbox.trim() === "" ? null : alertInbox.trim(),
          alerts_enabled: alertsEnabled,
          alert_on_pii: alertOnPii,
          alert_on_budget: alertOnBudget,
          alert_no_leads_hours: Number(noLeadsHours),
          session_ttl_hours: Number(sessionHours),
          default_monthly_budget: Number(defaultBudget),
          budget_alert_pct: Math.min(1, Math.max(0.01, Number(budgetPct) / 100)),
          business_hours_start: Number(bhStart),
          business_hours_end: Number(bhEnd),
          business_timezone: timezone.trim() || "America/New_York",
          default_retention_days: Number(retentionDays),
        }),
      });
      const d = await res.json();
      setMsg(
        d.ok
          ? { ok: true, text: "Settings saved." }
          : { ok: false, text: d.detail || d.error || "Save failed." },
      );
      if (d.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Alerts & notifications */}
      <section className={card}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <Bell className="size-4" /> Alerts &amp; notifications
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Where operational alerts (HITL, escalations, budget, chat health) are sent and which
          ones fire.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <span className={label}>Alert inbox</span>
            <input
              className={input}
              type="email"
              value={alertInbox}
              onChange={(e) => setAlertInbox(e.target.value)}
              placeholder="you@example.com (blank = INTERNAL_ALERT_INBOX env / default)"
            />
          </div>

          <Toggle
            checked={alertsEnabled}
            onChange={setAlertsEnabled}
            title="Master switch"
            hint="When off, no internal alert is sent regardless of the toggles below."
          />
          <Toggle
            checked={alertOnPii}
            onChange={setAlertOnPii}
            title="PII attack-pattern alerts"
            hint="Fires when one session triggers 3+ DLP blocks in 15 min."
          />
          <Toggle
            checked={alertOnBudget}
            onChange={setAlertOnBudget}
            title="Token budget alerts"
            hint="Fires when an agent crosses the warning threshold or runs out."
          />

          <div className="max-w-xs">
            <span className={label}>No-leads alert window (hours, 0 = off)</span>
            <input
              className={input}
              type="number"
              min={0}
              max={168}
              value={noLeadsHours}
              onChange={(e) => setNoLeadsHours(Number(e.target.value))}
            />
            <p className="mt-1 text-[11px] text-neutral-400">
              Alerts if zero visitor messages land in this window during business hours.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/60 pt-4">
          <button
            type="button"
            onClick={sendTestAlert}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white/70 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-white/85 disabled:opacity-50"
          >
            <Send className="size-3.5" />
            {testing ? "Sending…" : "Send test alert"}
          </button>
          <span className="text-[11px] text-neutral-400">
            Sends a test email to the inbox above using current settings.
          </span>
          {testMsg && (
            <span
              className={`flex w-full items-center gap-1.5 text-xs ${testMsg.ok ? "text-emerald-600" : "text-rose-600"}`}
            >
              {testMsg.ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
              {testMsg.text}
            </span>
          )}
        </div>
      </section>

      {/* Operator & security */}
      <section className={card}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <ShieldCheck className="size-4" /> Operator &amp; security
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Session lifetime for this admin. Changes apply on your next login.
        </p>

        <div className="mt-4 max-w-xs">
          <span className={label}>Session length (hours)</span>
          <input
            className={input}
            type="number"
            min={1}
            max={168}
            value={sessionHours}
            onChange={(e) => setSessionHours(Number(e.target.value))}
          />
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" />
          <span>
            The admin password is not editable here by design. Rotate it by changing{" "}
            <code className="rounded bg-amber-100 px-1">ADMIN_DASHBOARD_PASSWORD</code> in Vercel.
            Rotating it signs out every existing session.
          </span>
        </div>
      </section>

      {/* Business hours */}
      <section className={card}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <Clock className="size-4" /> Business hours
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Used by chat-health to suppress off-hours noise (the &quot;no leads&quot; / regression
          alert only fires on weekdays within this window).
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <span className={label}>Start hour (0–23)</span>
            <input
              className={input}
              type="number"
              min={0}
              max={23}
              value={bhStart}
              onChange={(e) => setBhStart(Number(e.target.value))}
            />
          </div>
          <div>
            <span className={label}>End hour (1–24)</span>
            <input
              className={input}
              type="number"
              min={1}
              max={24}
              value={bhEnd}
              onChange={(e) => setBhEnd(Number(e.target.value))}
            />
          </div>
          <div>
            <span className={label}>Timezone</span>
            <input
              className={input}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">
          Hours are interpreted in this IANA timezone (e.g. {bhStart}:00–{bhEnd}:00 local).
        </p>
      </section>

      {/* Costs & budget */}
      <section className={card}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <Wallet className="size-4" /> Costs &amp; budget caps
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Defaults for new agents and when budget warnings fire. Per-agent budgets stay editable
          on each agent.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className={label}>Default monthly token budget (new agents)</span>
            <input
              className={input}
              type="number"
              min={0}
              step={100000}
              value={defaultBudget}
              onChange={(e) => setDefaultBudget(Number(e.target.value))}
            />
            <p className="mt-1 text-[11px] text-neutral-400">
              {defaultBudget > 0
                ? `${defaultBudget.toLocaleString()} tokens/mo`
                : "0 = unlimited"}
            </p>
          </div>
          <div>
            <span className={label}>Budget warning threshold (%)</span>
            <input
              className={input}
              type="number"
              min={1}
              max={99}
              value={budgetPct}
              onChange={(e) => setBudgetPct(Number(e.target.value))}
            />
            <p className="mt-1 text-[11px] text-neutral-400">
              First alert at this %; 100% (exhausted) always alerts.
            </p>
          </div>
          <div>
            <span className={label}>Default data retention (days, new agents)</span>
            <input
              className={input}
              type="number"
              min={1}
              max={3650}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
            />
            <p className="mt-1 text-[11px] text-neutral-400">
              How long new agents keep conversation data. Per-agent value stays editable.
            </p>
          </div>
        </div>
      </section>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {msg && (
          <span
            className={`flex items-center gap-1.5 text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}
          >
            {msg.ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
