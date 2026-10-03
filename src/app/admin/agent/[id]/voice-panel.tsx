"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Phone } from "lucide-react";
import { voiceWelcome } from "@/lib/agent-runtime/disclosure";

type VoiceCfg = {
  enabled?: boolean;
  provider?: string;
  voice_en?: string;
  voice_es?: string;
  default_lang?: string;
  transfer_number?: string;
  recording_notice?: boolean;
  max_call_minutes?: number;
  vapi_secret_hash?: string;
};

/**
 * "Phone calls (voice)" (integrations.voice). Saved through
 * /api/admin/agents/[id]/update. Shows the exact URLs to paste into Twilio
 * or Vapi. The Vapi secret is generated server side and shown once.
 */
export function VoicePanel({
  agentId,
  integrations,
  agentName: agentNameProp,
}: {
  agentId: string;
  integrations: Record<string, unknown> | null;
  agentName: string;
}) {
  const router = useRouter();
  const cfg = ((integrations ?? {}).voice ?? {}) as VoiceCfg;

  const [enabled, setEnabled] = useState(cfg.enabled ?? false);
  const [provider, setProvider] = useState(cfg.provider ?? "twilio_cr");
  const [voiceEn, setVoiceEn] = useState(cfg.voice_en ?? "");
  const [voiceEs, setVoiceEs] = useState(cfg.voice_es ?? "");
  const [lang, setLang] = useState(cfg.default_lang ?? "es");
  const [transfer, setTransfer] = useState(cfg.transfer_number ?? "");
  const [notice, setNotice] = useState(cfg.recording_notice ?? true);
  const [maxMin, setMaxMin] = useState(cfg.max_call_minutes ?? 10);

  const [slug, setSlug] = useState<string | null>(null);
  const [fetchedName, setFetchedName] = useState("");
  const agentName = agentNameProp || fetchedName;
  const [env, setEnv] = useState<{ gatewayUrl: boolean; gatewaySecret: boolean } | null>(null);
  const [origin, setOrigin] = useState("");
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/admin/agents/${agentId}/credentials`)
      .then((r) => r.json())
      .then((d) => {
        setOrigin(window.location.origin);
        if (d.ok) {
          setSlug(d.slug ?? null);
          setFetchedName(d.name ?? "");
          setEnv(d.voiceEnv ?? null);
        }
      })
      .catch(() => {});
  }, [agentId]);

  async function save(rotate = false) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrations: {
            voice: {
              enabled,
              provider,
              voice_en: voiceEn.trim(),
              voice_es: voiceEs.trim(),
              default_lang: lang,
              transfer_number: transfer.trim(),
              recording_notice: notice,
              max_call_minutes: maxMin,
              ...(rotate ? { vapi_secret_rotate: true } : {}),
            },
          },
        }),
      });
      const d = await res.json();
      if (d.ok) {
        if (d.vapiSecret) setSecret(d.vapiSecret);
        setMsg({ ok: true, text: rotate ? "Secret generated. Copy it now, it is shown once." : "Voice settings saved." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.detail || d.error || "Save failed." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none";
  const labelCls = "block text-xs font-medium text-neutral-600 mb-1";
  const base = `${origin}/api/agent/${slug ?? "{slug}"}/voice`;
  const welcome = voiceWelcome(lang === "en" ? "en" : "es", agentName, { recordingNotice: notice });

  return (
    <section className="mt-6 rounded-xl border border-neutral-200 bg-white shadow-sm shadow-slate-900/10 p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
        <Phone className="size-4" /> Phone calls (voice)
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        The agent answers calls with the same rules as chat and texts: the AI disclosure, opt-out, crisis protocol, tool
        policies and audit all apply. Each call is a thread in the client&apos;s inbox.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Voice enabled
        </label>
        <div>
          <span className={labelCls}>Provider</span>
          <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="twilio_cr">Twilio ConversationRelay (voice gateway)</option>
            <option value="vapi">Vapi / custom LLM</option>
          </select>
        </div>
        <div>
          <span className={labelCls}>Default language</span>
          <select className={inputCls} value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="es">Spanish</option>
            <option value="en">English</option>
          </select>
        </div>
        <div>
          <span className={labelCls}>English voice (provider voice id)</span>
          <input className={inputCls} value={voiceEn} onChange={(e) => setVoiceEn(e.target.value)} placeholder="ElevenLabs voice id" />
        </div>
        <div>
          <span className={labelCls}>Spanish voice (provider voice id)</span>
          <input className={inputCls} value={voiceEs} onChange={(e) => setVoiceEs(e.target.value)} placeholder="ElevenLabs voice id" />
        </div>
        <div>
          <span className={labelCls}>Transfer number (E.164, optional)</span>
          <input
            className={inputCls}
            value={transfer}
            onChange={(e) => setTransfer(e.target.value)}
            placeholder="+15615551234"
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            Used while the business is open. Otherwise, or if empty, the agent takes a callback.
          </p>
        </div>
        <div>
          <span className={labelCls}>Maximum call length (minutes)</span>
          <input type="number" min={1} max={60} className={inputCls} value={maxMin} onChange={(e) => setMaxMin(Number(e.target.value))} />
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2">
          <input type="checkbox" checked={notice} onChange={(e) => setNotice(e.target.checked)} />
          Say the recording notice at the start (required in all-party-consent states like Florida)
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => save(false)}
          disabled={saving}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save voice settings"}
        </button>
        {provider === "vapi" && (
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-900 disabled:opacity-50"
          >
            {cfg.vapi_secret_hash ? "Rotate custom LLM secret" : "Generate custom LLM secret"}
          </button>
        )}
      </div>

      <div className="mt-5 border-t border-neutral-100 pt-4 text-xs text-neutral-600">
        <h4 className="text-sm font-semibold text-neutral-800">Where to paste</h4>
        {provider === "twilio_cr" ? (
          <>
            <p className="mt-1">
              Twilio console, the number&apos;s Voice configuration, &quot;A call comes in&quot;, Webhook, HTTP POST:
            </p>
            <code className="mt-1 block break-all rounded bg-neutral-50 p-2">{base}/incoming</code>
            <p className="mt-2">
              The session callback (<code>{base}/after</code>) is set automatically in the TwiML. Needs the gateway:{" "}
              {env ? (
                <span className={env.gatewayUrl && env.gatewaySecret ? "text-emerald-700" : "text-amber-700"}>
                  VOICE_GATEWAY_URL {env.gatewayUrl ? "set" : "missing"}, VOICE_GATEWAY_SECRET{" "}
                  {env.gatewaySecret ? "set" : "missing"}
                </span>
              ) : (
                "checking…"
              )}
            </p>
          </>
        ) : (
          <>
            <p className="mt-1">Vapi assistant, Model, Custom LLM, URL (Vapi adds /chat/completions):</p>
            <code className="mt-1 block break-all rounded bg-neutral-50 p-2">{base}/vapi</code>
            <p className="mt-2">
              API key: the custom LLM secret generated above ({cfg.vapi_secret_hash ? "one is set" : "none yet"}). Vapi sends
              it as a Bearer token. Set the assistant&apos;s first message to exactly:
            </p>
            <code className="mt-1 block break-words rounded bg-neutral-50 p-2">{welcome}</code>
            <p className="mt-2">Live transfer is not offered on this provider: escalations become callbacks.</p>
          </>
        )}
      </div>

      {secret && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Custom LLM secret (shown once)</p>
          <code className="mt-1 block break-all">{secret}</code>
        </div>
      )}
      {msg && (
        <p className={`mt-3 flex items-center gap-1.5 text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>
          {msg.ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
          {msg.text}
        </p>
      )}
    </section>
  );
}
