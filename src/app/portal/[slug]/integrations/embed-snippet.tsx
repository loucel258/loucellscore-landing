"use client";

import { useState } from "react";
import { Check, Copy, Code2, Globe2 } from "lucide-react";

type Props = {
  snippet: string;
  allowedOrigins: string[];
  status: string;
  lang: "en" | "es";
};

export function EmbedSnippet({ snippet, allowedOrigins, status, lang }: Props) {
  const [copied, setCopied] = useState(false);
  const isLive = status === "live";

  function copy() {
    navigator.clipboard.writeText(snippet).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {
        // Clipboard API can fail in HTTP / older browsers — fall back silently
      },
    );
  }

  return (
    <article className="relative overflow-hidden rounded-2xl border border-white/60 bg-white/75 shadow-sm shadow-slate-900/5 p-6 shadow-sm">
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-cyan-100/40 blur-3xl" aria-hidden />
      <div className="relative">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 text-white shadow-md">
              <Code2 className="size-5" />
            </span>
            <div>
              <p className="font-semibold text-neutral-900">
                {lang === "es" ? "Snippet de embed" : "Embed snippet"}
              </p>
              <p className="text-[11px] text-neutral-500">
                {lang === "es"
                  ? "Pégalo justo antes del </body> en cualquier página donde quieras el chat."
                  : "Paste just before </body> on any page where you want the chat to appear."}
              </p>
            </div>
          </div>
          {isLive ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
              {lang === "es" ? "En vivo" : "Live"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">
              {lang === "es" ? "No publicado" : "Not live"}
            </span>
          )}
        </header>

        <div className="mt-5 group relative">
          <pre className="overflow-x-auto rounded-xl bg-neutral-950 p-4 pr-14 text-[12px] leading-relaxed text-neutral-100">
            <code>{snippet}</code>
          </pre>
          <button
            type="button"
            onClick={copy}
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white backdrop-blur transition hover:bg-white/20"
            aria-label={lang === "es" ? "Copiar snippet" : "Copy snippet"}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied
              ? lang === "es"
                ? "Copiado"
                : "Copied"
              : lang === "es"
                ? "Copiar"
                : "Copy"}
          </button>
        </div>

        <div className="mt-6 border-t border-neutral-100 pt-5">
          <div className="flex items-center gap-2">
            <Globe2 className="size-4 text-neutral-500" />
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-700">
              {lang === "es" ? "Dominios autorizados" : "Authorized domains"}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            {lang === "es"
              ? "El widget solo carga en estos dominios. Para agregar o quitar uno, contáctanos."
              : "The widget only loads on these domains. Contact us to add or remove one."}
          </p>
          {allowedOrigins.length === 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              {lang === "es"
                ? "Aún no hay dominios autorizados. El widget no cargará hasta que se configure al menos uno."
                : "No domains authorized yet. The widget will not load until at least one is configured."}
            </div>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {allowedOrigins.map((origin) => (
                <li
                  key={origin}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-1 text-[12px] font-medium text-neutral-800 ring-1 ring-neutral-200"
                >
                  <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                  {origin}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
