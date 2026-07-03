import { CloudOff } from "lucide-react";

/**
 * Rendered when the data layer is unreachable (missing env in dev, or a
 * Supabase outage in prod). Replaces the old `return null` blank page,
 * which read as "the product is broken" to a paying client. Bilingual
 * static copy because resolving the client's language preference also
 * requires the data layer.
 */
export function ServiceUnavailable() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 p-8 text-center">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500">
          <CloudOff className="size-6" />
        </span>
        <h2 className="mt-4 text-lg font-bold text-neutral-900">
          Temporarily unavailable
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600">
          We can&apos;t reach your data right now. Your agent keeps working and
          nothing is lost; this page will recover on its own. If it persists,
          email{" "}
          <a href="mailto:contact@loucellscore.com" className="font-medium text-cyan-700 underline underline-offset-2">
            contact@loucellscore.com
          </a>
          .
        </p>
        <p className="mt-3 text-xs text-neutral-500">
          No podemos cargar tus datos en este momento. Tu agente sigue
          funcionando y no se pierde nada; esta página se recuperará sola.
        </p>
      </div>
    </div>
  );
}
