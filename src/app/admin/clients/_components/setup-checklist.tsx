"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, Circle, Copy, ListChecks } from "lucide-react";
import { clearPasscode, peekPasscode, subscribePasscodes } from "./passcode-stash";

/**
 * Setup checklist for an agent that is not live yet. Done states come from
 * the server (persona saved, origins set, status live, owner signed in to
 * the portal, first conversation seen). The one-time passcode only shows up
 * right after New client created it.
 */

export type ChecklistAgent = {
  id: string;
  name: string;
  engagementId: string;
  slug: string | null;
  hasPersona: boolean;
  /** request_booking is on and this is a client agent (no house fallback). */
  needsBookingLink: boolean;
  hasBookingLink: boolean;
  originsCount: number;
  live: boolean;
  portalSlug: string | null;
  portalSignedIn: boolean;
  hasTraffic: boolean;
};

export function SetupChecklist({
  agent,
  baseUrl,
  configHref,
}: {
  agent: ChecklistAgent;
  baseUrl: string;
  /** Where "Open" goes: the agent's config block in Setup. */
  configHref: string;
}) {
  const stashed = useSyncExternalStore(
    subscribePasscodes,
    () => peekPasscode(agent.engagementId),
    () => null,
  );
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, tag: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(tag);
        setTimeout(() => setCopied(null), 1500);
      },
      () => setCopied(null),
    );
  }

  const portalSlug = stashed?.portalSlug ?? agent.portalSlug;
  const portalUrl = portalSlug ? `${baseUrl}/portal/${portalSlug}` : null;
  const snippet = agent.slug ? `<script src="${baseUrl}/agent.js" data-agent="${agent.slug}" defer></script>` : null;

  const items: Array<{ key: string; label: string; done: boolean; hint: string; body?: React.ReactNode }> = [
    {
      key: "persona",
      label: "Write the persona",
      done: agent.hasPersona,
      hint: agent.hasPersona ? "Saved." : "What the agent knows about the business and how it talks.",
    },
  ];
  if (agent.needsBookingLink) {
    items.push({
      key: "booking",
      label: "Add the booking link",
      done: agent.hasBookingLink,
      hint: agent.hasBookingLink ? "Saved." : "The client's own booking page. Without it the agent won't offer booking.",
    });
  }
  items.push(
    {
      key: "origins",
      label: "Check the allowed origins",
      done: agent.originsCount > 0,
      hint:
        agent.originsCount > 0
          ? `${agent.originsCount} site${agent.originsCount === 1 ? "" : "s"} allowed. Confirm they match where the widget goes.`
          : "The widget is rejected everywhere until a site is added.",
    },
    {
      key: "live",
      label: "Go live",
      done: agent.live,
      hint: agent.live ? "Live." : "Needs persona, origins and a slug. Use Status transition in the configuration below.",
    },
    {
      key: "portal",
      label: "Send the owner the portal link and passcode",
      done: agent.portalSignedIn,
      hint: agent.portalSignedIn ? "The owner has signed in." : "Done once the owner signs in.",
      body: portalUrl ? (
        <div className="mt-2 space-y-2">
          <CopyRow value={portalUrl} label="Copy portal link" copied={copied === "portal"} onCopy={() => copy(portalUrl, "portal")} />
          {stashed ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
              <p className="text-[11px] font-semibold text-emerald-800">Passcode, shown once. Save it now.</p>
              <CopyRow
                value={stashed.passcode}
                label="Copy passcode"
                mono
                copied={copied === "passcode"}
                onCopy={() => copy(stashed.passcode, "passcode")}
              />
              <button
                type="button"
                onClick={() => clearPasscode(agent.engagementId)}
                className="mt-1.5 min-h-[36px] text-[11px] font-medium text-emerald-800 underline underline-offset-2"
              >
                I saved it. Hide the passcode.
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-neutral-500">
              The passcode is shown only once. Rotate it under Client portal access below to send a new one.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-neutral-500">No portal yet. Create it under Client portal access below.</p>
      ),
    },
    {
      key: "embed",
      label: "Send the embed snippet",
      done: agent.hasTraffic,
      hint: agent.hasTraffic ? "First conversation received." : "Done once the first conversation comes in.",
      body: snippet ? (
        <div className="mt-2">
          <CopyRow value={snippet} label="Copy snippet" mono copied={copied === "snippet"} onCopy={() => copy(snippet, "snippet")} />
        </div>
      ) : null,
    },
  );

  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50/40 p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <ListChecks className="size-4 text-cyan-700" /> Finish setting up {agent.name}
        </h2>
        <span className="text-xs tabular-nums text-neutral-600">
          {doneCount} of {items.length} done
        </span>
      </header>
      <ol className="mt-3 divide-y divide-cyan-100">
        {items.map((item) => (
          <li key={item.key} className="flex gap-3 py-2.5">
            <span className={`mt-0.5 shrink-0 ${item.done ? "text-emerald-600" : "text-neutral-400"}`} aria-hidden>
              {item.done ? <Check className="size-4" /> : <Circle className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className={`text-sm ${item.done ? "text-neutral-500" : "font-medium text-neutral-900"}`}>
                  <span className="sr-only">{item.done ? "Done: " : "To do: "}</span>
                  {item.label}
                </p>
                {!item.done && item.key !== "portal" && item.key !== "embed" && (
                  <Link href={configHref} className="text-xs font-medium text-cyan-700 hover:underline">
                    Open
                  </Link>
                )}
              </div>
              <p className="text-[11px] text-neutral-500">{item.hint}</p>
              {item.body}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CopyRow({
  value,
  label,
  mono,
  copied,
  onCopy,
}: {
  value: string;
  label: string;
  mono?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code
        className={`min-w-0 flex-1 truncate rounded-md bg-white px-2 py-1.5 text-[11px] text-neutral-800 ring-1 ring-neutral-200 ${
          mono ? "font-mono tracking-wide" : ""
        }`}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={label}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-white text-neutral-600 ring-1 ring-neutral-200 hover:text-neutral-900"
      >
        {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
