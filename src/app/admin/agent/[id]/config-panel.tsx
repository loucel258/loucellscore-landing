"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Settings2,
  Globe2,
  X,
  Plus,
  Check,
  Copy,
  KeyRound,
  Rocket,
  AlertTriangle,
  Wallet,
} from "lucide-react";
import { useConfirmTap } from "@/components/admin/use-confirm-tap";

type AgentConfig = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  allowedOrigins: string[];
  systemPrompt: string | null;
  greetingMessage: string | null;
  brandColor: string | null;
  toolsEnabled: string[];
  monthlyTokenBudget: number;
  maxTokensPerMessage: number;
  notes: string | null;
  engagementId: string;
  clientName: string;
  monthlyRetainerCents: number;
  retainerActive: boolean;
  minutesSavedPerConversation: number;
  /** Saved portal slug for this engagement (client_portal_access), if any. */
  portalSlug: string | null;
  /** integrations.booking.link_url: what request_booking shares. */
  bookingLinkUrl: string | null;
  /** Loucells' own site agents fall back to the house Cal.com link. */
  isHouseAgent: boolean;
};

const ALL_TOOLS = [
  { id: "request_booking", label: "Request booking (shares the booking link)" },
  { id: "escalate_to_human", label: "Escalate to human (HITL queue)" },
  { id: "request_human_approval", label: "Request human approval (quotes/refunds/reviews → portal)" },
];

const STATUS_FLOW: Array<{ key: string; label: string }> = [
  { key: "designing", label: "Designing" },
  { key: "shadow_mode", label: "Shadow" },
  { key: "uat", label: "UAT" },
  { key: "live", label: "Live" },
  { key: "paused", label: "Paused" },
  { key: "archived", label: "Archived" },
];

// Transitions that take the agent off the air need a second tap.
const RISKY_STATUSES = new Set(["paused", "archived"]);

export function ConfigPanel({ agent, baseUrl }: { agent: AgentConfig; baseUrl: string }) {
  const router = useRouter();
  const [name, setName] = useState(agent.name);
  const [slug, setSlug] = useState(agent.slug ?? "");
  const [origins, setOrigins] = useState<string[]>(agent.allowedOrigins);
  const [newOrigin, setNewOrigin] = useState("");
  const [persona, setPersona] = useState(agent.systemPrompt ?? "");
  const [greeting, setGreeting] = useState(agent.greetingMessage ?? "");
  const [brandColor, setBrandColor] = useState(agent.brandColor ?? "#0891b2");
  const [tools, setTools] = useState<string[]>(agent.toolsEnabled);
  const [bookingLink, setBookingLink] = useState(agent.bookingLinkUrl ?? "");
  const [budget, setBudget] = useState(agent.monthlyTokenBudget);
  const [maxTokens, setMaxTokens] = useState(agent.maxTokensPerMessage);
  const [notes, setNotes] = useState(agent.notes ?? "");
  const [retainerUsd, setRetainerUsd] = useState(Math.round(agent.monthlyRetainerCents) / 100);
  const [retainerActive, setRetainerActive] = useState(agent.retainerActive);
  const [minutesSaved, setMinutesSaved] = useState(agent.minutesSavedPerConversation);
  const [versionNote, setVersionNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [passcodeBusy, setPasscodeBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [portalSlug, setPortalSlug] = useState<string | null>(agent.portalSlug);
  const confirm = useConfirmTap();

  // The slug is the client's embed identifier: editable only while
  // designing, or to assign the first one. The API enforces the same rule.
  const slugEditable = agent.status === "designing" || !agent.slug;

  const goLiveReady = slug.length >= 2 && origins.length > 0 && persona.trim().length > 0;

  function copy(text: string, tag: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function addOrigin() {
    const v = newOrigin.trim();
    if (!v) return;
    if (!/^https?:\/\//.test(v)) {
      setSaveMsg({ ok: false, text: "Origin must start with http:// or https://" });
      return;
    }
    try {
      const o = new URL(v).origin.toLowerCase();
      if (!origins.includes(o)) setOrigins([...origins, o]);
      setNewOrigin("");
      setSaveMsg(null);
    } catch {
      setSaveMsg({ ok: false, text: "That doesn't look like a valid URL" });
    }
  }

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${agent.id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slugEditable ? slug || null : undefined,
          allowedOrigins: origins,
          systemPrompt: persona || null,
          greetingMessage: greeting || null,
          brandColor,
          toolsEnabled: tools,
          monthlyTokenBudget: budget,
          maxTokensPerMessage: maxTokens,
          notes: notes || null,
          monthlyRetainerCents: Math.max(0, Math.round((Number.isFinite(retainerUsd) ? retainerUsd : 0) * 100)),
          retainerActive,
          minutesSavedPerConversation: Math.max(0, Math.round(Number.isFinite(minutesSaved) ? minutesSaved : 0)),
          ...(versionNote.trim() ? { versionNote: versionNote.trim() } : {}),
          // Only sent when it changed, so ordinary saves don't rewrite integrations.
          ...(bookingLink.trim() !== (agent.bookingLinkUrl ?? "")
            ? { integrations: { booking: { link_url: bookingLink.trim() } } }
            : {}),
        }),
      });
      const body = await res.json();
      if (body.ok) {
        setSaveMsg({ ok: true, text: body.changed.length > 0 ? `Saved: ${body.changed.join(", ")}` : "Nothing to save" });
        setVersionNote("");
        router.refresh();
      } else {
        setSaveMsg({ ok: false, text: `${body.error}${body.detail ? `: ${body.detail}` : ""}` });
      }
    } catch {
      setSaveMsg({ ok: false, text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: string) {
    setStatusBusy(status);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${agent.id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (body.ok) {
        router.refresh();
      } else {
        setSaveMsg({ ok: false, text: `${body.error}${body.detail ? `: ${body.detail}` : ""}` });
      }
    } catch {
      setSaveMsg({ ok: false, text: "Network error" });
    } finally {
      setStatusBusy(null);
    }
  }

  async function rotatePasscode() {
    setPasscodeBusy(true);
    setSaveMsg(null);
    try {
      // Rotation is scoped by engagement, never by slug alone: agent slugs
      // and portal slugs are separate namespaces.
      let res = await fetch("/api/admin/portal-access/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // With several portals on one engagement, name the one shown here.
        body: JSON.stringify({
          engagementId: agent.engagementId,
          ...(portalSlug ? { clientSlug: portalSlug } : {}),
        }),
      });
      let body = await res.json();
      if (!body.ok && body.error === "not_found") {
        // No portal for this engagement yet: create one, addressed by the
        // agent's SAVED slug (never unsaved form state).
        if (!agent.slug) {
          setSaveMsg({ ok: false, text: "Save a slug first. The new portal uses it as its address." });
          return;
        }
        res = await fetch("/api/admin/portal-access/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            engagementId: agent.engagementId,
            clientSlug: agent.slug,
            displayName: agent.clientName,
          }),
        });
        body = await res.json();
      }
      if (body.ok) {
        setPasscode(body.passcode);
        if (typeof body.clientSlug === "string") setPortalSlug(body.clientSlug);
      } else {
        setSaveMsg({ ok: false, text: `Passcode: ${body.detail ?? body.error}` });
      }
    } catch {
      setSaveMsg({ ok: false, text: "Network error rotating passcode" });
    } finally {
      setPasscodeBusy(false);
    }
  }

  // Built from the saved slug: an unsaved edit would hand out a broken snippet.
  const snippet = agent.slug
    ? `<script src="${baseUrl}/agent.js" data-agent="${agent.slug}" defer></script>`
    : null;

  const inputCls =
    "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100";
  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500";

  return (
    <section className="mt-6 rounded-xl border border-neutral-200 bg-white shadow-sm shadow-slate-900/10 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          <Settings2 className="size-3.5" /> Configuration
        </h2>
        {saveMsg && (
          <p className={`text-xs font-medium ${saveMsg.ok ? "text-emerald-700" : "text-rose-700"}`}>
            {saveMsg.text}
          </p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left column: identity + origins + budget */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Display name</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Public slug</label>
              <input
                className={`${inputCls} ${slugEditable ? "" : "cursor-not-allowed bg-neutral-50 text-neutral-500"}`}
                value={slug}
                readOnly={!slugEditable}
                onChange={(e) => {
                  if (slugEditable) setSlug(e.target.value.toLowerCase());
                }}
                placeholder="acme-medspa"
              />
              {!slugEditable && (
                <p className="mt-1 text-[10px] text-neutral-500">
                  Locked after designing. The client&apos;s embed code uses it.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className={labelCls}>
              <Globe2 className="mr-1 inline size-3" /> Allowed origins
            </label>
            <div className="flex flex-wrap gap-1.5">
              {origins.map((o) => (
                <span
                  key={o}
                  className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-800 ring-1 ring-neutral-200"
                >
                  {o}
                  <button
                    type="button"
                    onClick={() => setOrigins(origins.filter((x) => x !== o))}
                    className="text-neutral-400 hover:text-rose-600"
                    aria-label={`Remove ${o}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {origins.length === 0 && (
                <span className="text-[11px] italic text-amber-700">
                  Empty = widget rejected everywhere
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className={inputCls}
                value={newOrigin}
                onChange={(e) => setNewOrigin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOrigin();
                  }
                }}
                placeholder="https://client-domain.com"
              />
              <button
                type="button"
                onClick={addOrigin}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-700"
              >
                <Plus className="size-3" /> Add
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Monthly token budget</label>
              <input
                type="number"
                min={0}
                step={100_000}
                className={inputCls}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
              <p className="mt-1 text-[10px] text-neutral-500">0 = unlimited</p>
            </div>
            <div>
              <label className={labelCls}>Max tokens / reply</label>
              <input
                type="number"
                min={256}
                max={8192}
                step={256}
                className={inputCls}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Brand color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-neutral-300"
                  aria-label="Brand color"
                />
                <input
                  className={inputCls}
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Tools enabled</label>
              <div className="space-y-1.5 pt-1">
                {ALL_TOOLS.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-xs text-neutral-700">
                    <input
                      type="checkbox"
                      checked={tools.includes(t.id)}
                      onChange={(e) =>
                        setTools(
                          e.target.checked
                            ? [...tools, t.id]
                            : tools.filter((x) => x !== t.id),
                        )
                      }
                      className="size-3.5 accent-cyan-600"
                    />
                    {t.label}
                  </label>
                ))}
              </div>
              {tools.includes("request_booking") && (
                <div className="mt-2">
                  <label className={labelCls}>Booking link (https)</label>
                  <input
                    type="url"
                    className={inputCls}
                    value={bookingLink}
                    onChange={(e) => setBookingLink(e.target.value)}
                    placeholder={agent.isHouseAgent ? "Empty = Loucells Core Cal.com" : "https://the-client-booking-page.com"}
                  />
                  {!agent.isHouseAgent && !bookingLink.trim() && (
                    <p className="mt-1 text-[10px] text-amber-700">
                      Without a link the agent won&apos;t offer booking. Use the client&apos;s own booking page.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 p-3">
            <h3 className={labelCls}>
              <Wallet className="mr-1 inline size-3" /> Billing
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Retainer $/month</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className={inputCls}
                  value={retainerUsd}
                  onChange={(e) => setRetainerUsd(Number(e.target.value))}
                />
              </div>
              <div>
                <label className={labelCls}>Minutes saved / conversation</label>
                <input
                  type="number"
                  min={0}
                  max={240}
                  step={1}
                  className={inputCls}
                  value={minutesSaved}
                  onChange={(e) => setMinutesSaved(Number(e.target.value))}
                />
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-neutral-700">
              <input
                type="checkbox"
                checked={retainerActive}
                onChange={(e) => setRetainerActive(e.target.checked)}
                className="size-3.5 accent-cyan-600"
              />
              Retainer active (counts toward MRR)
            </label>
            <p className="mt-1 text-[10px] text-neutral-500">
              Saved with the configuration. Turning it on or off stamps the start or cancel date.
            </p>
          </div>
        </div>

        {/* Right column: persona + greeting + notes */}
        <div className="space-y-4">
          <div>
            <label className={labelCls}>
              Persona (system prompt) · {persona.length}/12000
            </label>
            <textarea
              className={`${inputCls} min-h-[160px] font-mono text-xs leading-relaxed`}
              value={persona}
              maxLength={12000}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="You are the AI assistant for…"
            />
            <p className="mt-1 text-[10px] text-neutral-500">
              Wrapped in the Trust Stack safety base. The persona
              cannot override governance rules.
            </p>
          </div>
          <div>
            <label className={labelCls}>Greeting message</label>
            <input
              className={inputCls}
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="Hi! How can I help you today?"
            />
          </div>
          <div>
            <label className={labelCls}>Internal notes</label>
            <textarea
              className={`${inputCls} min-h-[60px]`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
        <input
          className={`${inputCls} min-w-0 flex-1 sm:max-w-sm`}
          value={versionNote}
          maxLength={500}
          onChange={(e) => setVersionNote(e.target.value)}
          placeholder="Version note (optional): why this change"
          aria-label="Version note"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save configuration"}
        </button>
      </div>

      {/* Status transitions */}
      <div className="mt-5 border-t border-neutral-100 pt-4">
        <h3 className={labelCls}>
          <Rocket className="mr-1 inline size-3" /> Status transition
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FLOW.map((s) => {
            const isCurrent = s.key === agent.status;
            const isLiveBlocked = s.key === "live" && !goLiveReady;
            const confirmKey = `status:${s.key}`;
            const isArmed = confirm.armed === confirmKey;
            return (
              <button
                key={s.key}
                type="button"
                disabled={isCurrent || statusBusy !== null || isLiveBlocked}
                onClick={() =>
                  RISKY_STATUSES.has(s.key)
                    ? confirm.tap(confirmKey, () => setStatus(s.key))
                    : setStatus(s.key)
                }
                title={isLiveBlocked ? "Needs slug + origins + persona before go-live" : undefined}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  isCurrent
                    ? "bg-cyan-600 text-white"
                    : isLiveBlocked
                      ? "cursor-not-allowed bg-neutral-100 text-neutral-400"
                      : isArmed
                        ? "bg-rose-600 text-white hover:bg-rose-700"
                        : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                {statusBusy === s.key ? "…" : isArmed ? `${s.label}? Confirm` : s.label}
              </button>
            );
          })}
        </div>
        {!goLiveReady && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-700">
            <AlertTriangle className="size-3" />
            Go-live blocked: needs{" "}
            {[
              slug.length < 2 && "slug",
              origins.length === 0 && "≥1 allowed origin",
              persona.trim().length === 0 && "persona",
            ]
              .filter(Boolean)
              .join(", ")}
          </p>
        )}
      </div>

      {/* Embed snippet + portal passcode */}
      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-neutral-100 pt-4 lg:grid-cols-2">
        <div>
          <h3 className={labelCls}>Embed snippet</h3>
          {snippet ? (
            <div className="group relative">
              <pre className="overflow-x-auto rounded-lg bg-neutral-950 p-3 pr-12 text-[11px] leading-relaxed text-neutral-100">
                <code>{snippet}</code>
              </pre>
              <button
                type="button"
                onClick={() => copy(snippet, "snippet")}
                className="absolute right-2 top-2 rounded-md bg-white/10 p-1.5 text-white hover:bg-neutral-50/60"
                aria-label="Copy snippet"
              >
                {copied === "snippet" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
            </div>
          ) : (
            <p className="text-xs italic text-neutral-400">Save a slug first</p>
          )}
        </div>
        <div>
          <h3 className={labelCls}>
            <KeyRound className="mr-1 inline size-3" /> Client portal access
          </h3>
          {passcode ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                New passcode. Shown once, save it now
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="text-sm font-bold tracking-widest text-emerald-900">{passcode}</code>
                <button
                  type="button"
                  onClick={() => copy(passcode, "passcode")}
                  className="rounded-md bg-emerald-100 p-1 text-emerald-700 hover:bg-emerald-200"
                  aria-label="Copy passcode"
                >
                  {copied === "passcode" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </button>
              </div>
            </div>
          ) : portalSlug ? (
            <div>
              <button
                type="button"
                onClick={() => confirm.tap("rotate", rotatePasscode)}
                disabled={passcodeBusy}
                className={`rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
                  confirm.armed === "rotate" ? "bg-rose-600 hover:bg-rose-700" : "bg-neutral-900 hover:bg-neutral-700"
                }`}
              >
                {passcodeBusy ? "Working…" : confirm.armed === "rotate" ? "Confirm?" : "Rotate portal passcode"}
              </button>
              {confirm.armed === "rotate" && (
                <p className="mt-1.5 text-[11px] text-rose-700">
                  The client&apos;s current passcode stops working. Tap again to continue.
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={rotatePasscode}
              disabled={passcodeBusy || !agent.slug}
              className="rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {passcodeBusy ? "Working…" : "Create portal access"}
            </button>
          )}
          <p className="mt-1.5 text-[10px] text-neutral-500">
            {portalSlug
              ? `Portal: ${baseUrl}/portal/${portalSlug}`
              : agent.slug
                ? `No portal yet. It will live at ${baseUrl}/portal/${agent.slug}`
                : "No portal yet. Save a slug first."}
          </p>
        </div>
      </div>
    </section>
  );
}
