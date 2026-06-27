"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, KeyRound, Check, AlertTriangle } from "lucide-react";

type CalendarCfg = { provider?: string; calendar_id?: string; timezone?: string };
type RemindersCfg = {
  enabled?: boolean;
  lead_hours?: number;
  channel?: string;
  from_number?: string;
};
type Integrations = { calendar?: CalendarCfg; reminders?: RemindersCfg; locale?: string };

type ConfiguredProvider = { provider: string; account_identifier: string | null };

export function IntegrationsPanel({
  agentId,
  integrations,
}: {
  agentId: string;
  integrations: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const integ = (integrations ?? {}) as Integrations;
  const cal = integ.calendar ?? {};
  const rem = integ.reminders ?? {};

  const [enabled, setEnabled] = useState<boolean>(rem.enabled ?? false);
  const [calendarId, setCalendarId] = useState(cal.calendar_id ?? "");
  const [timezone, setTimezone] = useState(cal.timezone ?? "America/New_York");
  const [fromNumber, setFromNumber] = useState(rem.from_number ?? "");
  const [leadHours, setLeadHours] = useState<number>(rem.lead_hours ?? 24);
  const [locale, setLocale] = useState<string>(integ.locale ?? "es");

  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");

  const [externalUrl, setExternalUrl] = useState("");
  const [externalSecret, setExternalSecret] = useState("");

  const [configured, setConfigured] = useState<ConfiguredProvider[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/admin/agents/${agentId}/credentials`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setConfigured(d.configured ?? []);
      })
      .catch(() => {});
  }, [agentId]);

  const twilioConfigured = configured.find((c) => c.provider === "twilio");
  const externalConfigured = configured.find((c) => c.provider === "external_booking");

  async function saveReminders() {
    setSaving("reminders");
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrations: {
            calendar: { provider: "google", calendar_id: calendarId.trim(), timezone },
            reminders: {
              enabled,
              lead_hours: leadHours,
              channel: "sms",
              from_number: fromNumber.trim(),
            },
            locale,
          },
        }),
      });
      const d = await res.json();
      setMsg(
        d.ok
          ? { ok: true, text: "Reminder settings saved." }
          : { ok: false, text: d.detail || d.error || "Save failed." },
      );
      if (d.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(null);
    }
  }

  async function saveTwilio() {
    if (!twilioSid.trim() || !twilioToken.trim()) {
      setMsg({ ok: false, text: "Enter both Twilio SID and Auth Token." });
      return;
    }
    setSaving("twilio");
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "twilio",
          account_identifier: twilioSid.trim(),
          access_token: twilioToken.trim(),
        }),
      });
      const d = await res.json();
      if (d.ok) {
        setMsg({ ok: true, text: "Twilio credentials stored in vault." });
        setTwilioToken("");
        const r = await fetch(`/api/admin/agents/${agentId}/credentials`).then((x) => x.json());
        if (r.ok) setConfigured(r.configured ?? []);
      } else {
        setMsg({ ok: false, text: d.detail || d.error || "Save failed." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(null);
    }
  }

  async function saveExternalBooking() {
    if (!externalUrl.trim() || !externalSecret.trim()) {
      setMsg({ ok: false, text: "Enter the app URL and the shared secret." });
      return;
    }
    if (externalSecret.trim().length < 16) {
      setMsg({ ok: false, text: "Shared secret must be at least 16 characters." });
      return;
    }
    setSaving("external_booking");
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "external_booking",
          account_identifier: externalUrl.trim().replace(/\/+$/, ""),
          webhook_secret: externalSecret.trim(),
        }),
      });
      const d = await res.json();
      if (d.ok) {
        setMsg({ ok: true, text: "External booking backend stored in vault." });
        setExternalSecret("");
        const r = await fetch(`/api/admin/agents/${agentId}/credentials`).then((x) => x.json());
        if (r.ok) setConfigured(r.configured ?? []);
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.detail || d.error || "Save failed." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(null);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none";
  const labelCls = "block text-xs font-medium text-neutral-600 mb-1";

  return (
    <section className="mt-6 rounded-xl border border-white/60 bg-white/75 shadow-sm shadow-slate-900/5 p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
        <CalendarClock className="size-4" /> Front Desk — Reminders &amp; Keys
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        Powers the 24h appointment reminder cron. Reads the client&apos;s Google Calendar and
        texts via their Twilio. Keys are stored encrypted in the vault.
      </p>

      {/* Reminder settings */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Reminders enabled
        </label>
        <div className="sm:col-span-2">
          <span className={labelCls}>Google Calendar ID (share calendar w/ the service account)</span>
          <input
            className={inputCls}
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            placeholder="abc123@group.calendar.google.com"
          />
        </div>
        <div>
          <span className={labelCls}>Timezone</span>
          <input className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <div>
          <span className={labelCls}>Twilio &quot;from&quot; number (E.164)</span>
          <input
            className={inputCls}
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            placeholder="+15615551234"
          />
        </div>
        <div>
          <span className={labelCls}>Lead time (hours before)</span>
          <input
            type="number"
            min={1}
            max={168}
            className={inputCls}
            value={leadHours}
            onChange={(e) => setLeadHours(Number(e.target.value))}
          />
        </div>
        <div>
          <span className={labelCls}>Language</span>
          <select className={inputCls} value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="es">Spanish</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
      <button
        onClick={saveReminders}
        disabled={saving === "reminders"}
        className="mt-3 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
      >
        {saving === "reminders" ? "Saving…" : "Save reminder settings"}
      </button>

      {/* Twilio credentials */}
      <div className="mt-6 border-t border-neutral-100 pt-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <KeyRound className="size-4" /> Twilio credentials
          {twilioConfigured && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              <Check className="size-2.5" /> configured
              {twilioConfigured.account_identifier
                ? ` (${twilioConfigured.account_identifier.slice(0, 6)}…)`
                : ""}
            </span>
          )}
        </h4>
        <p className="mt-1 text-xs text-neutral-500">
          Stored encrypted. The auth token is write-only and never shown again.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className={labelCls}>Account SID</span>
            <input
              className={inputCls}
              value={twilioSid}
              onChange={(e) => setTwilioSid(e.target.value)}
              placeholder="ACxxxxxxxxxxxxxxxx"
            />
          </div>
          <div>
            <span className={labelCls}>Auth Token</span>
            <input
              type="password"
              className={inputCls}
              value={twilioToken}
              onChange={(e) => setTwilioToken(e.target.value)}
              placeholder="Paste Twilio Auth Token"
            />
          </div>
        </div>
        <button
          onClick={saveTwilio}
          disabled={saving === "twilio"}
          className="mt-3 rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-900 disabled:opacity-50"
        >
          {saving === "twilio" ? "Saving…" : "Save Twilio keys to vault"}
        </button>
      </div>

      {/* External booking backend */}
      <div className="mt-6 border-t border-neutral-100 pt-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <KeyRound className="size-4" /> External booking backend
          {externalConfigured && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              <Check className="size-2.5" /> configured
              {externalConfigured.account_identifier
                ? ` (${externalConfigured.account_identifier})`
                : ""}
            </span>
          )}
        </h4>
        <p className="mt-1 text-xs text-neutral-500">
          When set, this workspace delegates booking to its own app (source of truth) and Loucells
          mirrors it. The secret must match the app&apos;s <code>LOUCELLS_INTEGRATION_SECRET</code>.
          The secret is write-only and never shown again.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className={labelCls}>App URL</span>
            <input
              className={inputCls}
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://nailestudio.com"
            />
          </div>
          <div>
            <span className={labelCls}>Shared secret (≥16 chars)</span>
            <input
              type="password"
              className={inputCls}
              value={externalSecret}
              onChange={(e) => setExternalSecret(e.target.value)}
              placeholder="Paste the shared HMAC secret"
            />
          </div>
        </div>
        <button
          onClick={saveExternalBooking}
          disabled={saving === "external_booking"}
          className="mt-3 rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-900 disabled:opacity-50"
        >
          {saving === "external_booking" ? "Saving…" : "Save external booking to vault"}
        </button>
      </div>

      {msg && (
        <p
          className={`mt-3 flex items-center gap-1.5 text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}
        >
          {msg.ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
          {msg.text}
        </p>
      )}
    </section>
  );
}
