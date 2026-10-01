"use client";

import { useState } from "react";
import { Check, Copy, Code2, Globe2 } from "lucide-react";

export type EmbedLabels = {
  title: string;
  desc: string;
  live: string;
  notLive: string;
  copy: string;
  copied: string;
  copyAria: string;
  domains: string;
  domainsDesc: string;
  domainsNone: string;
};

/** The website chat's embed code and the sites it may load on. Copy arrives translated. */
export function EmbedSnippet({
  snippet,
  allowedOrigins,
  isLive,
  labels,
}: {
  snippet: string;
  allowedOrigins: string[];
  isLive: boolean;
  labels: EmbedLabels;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(snippet).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {
        // Clipboard API can fail on HTTP / older browsers: the code stays selectable.
      },
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Code2 className="mt-0.5 size-4 shrink-0 text-neutral-500" />
          <div>
            <p className="text-sm font-semibold text-neutral-900">{labels.title}</p>
            <p className="text-[11px] text-neutral-500">{labels.desc}</p>
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
            isLive ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"
          }`}
        >
          {isLive ? labels.live : labels.notLive}
        </span>
      </header>

      <div className="relative mt-3">
        <pre className="overflow-x-auto rounded-lg bg-neutral-950 p-3 pr-24 text-[12px] leading-relaxed text-neutral-100">
          <code>{snippet}</code>
        </pre>
        <button
          type="button"
          onClick={copy}
          aria-label={labels.copyAria}
          className="absolute right-2 top-2 inline-flex min-h-8 items-center gap-1 rounded-md bg-white/10 px-2.5 text-[11px] font-medium text-white transition hover:bg-white/20"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? labels.copied : labels.copy}
        </button>
      </div>

      <div className="mt-4 border-t border-neutral-100 pt-3">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700">
          <Globe2 className="size-3.5 text-neutral-500" /> {labels.domains}
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-500">{labels.domainsDesc}</p>
        {allowedOrigins.length === 0 ? (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{labels.domainsNone}</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {allowedOrigins.map((origin) => (
              <li
                key={origin}
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-[12px] font-medium text-neutral-800 ring-1 ring-neutral-200"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                {origin}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
