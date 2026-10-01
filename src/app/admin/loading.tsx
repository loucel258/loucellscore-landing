/**
 * Segment-level loading boundary for the admin. Every admin page is
 * force-dynamic and runs several Supabase queries, so without this a click
 * in the sidebar looked frozen until the whole page resolved. Same shape as
 * the portal skeleton: hero surface, metric row, two panels.
 */
export default function AdminLoading() {
  return (
    <div
      className="animate-pulse space-y-7 px-6 py-6 lg:px-8 lg:py-8"
      aria-busy="true"
      aria-live="polite"
    >
      {/* Hero surface */}
      <div className="h-44 rounded-3xl border border-neutral-200 bg-neutral-50/60" />

      {/* Metric row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="h-24 rounded-2xl border border-neutral-200 bg-neutral-50/60" />
        <div className="h-24 rounded-2xl border border-neutral-200 bg-neutral-50/60" />
        <div className="h-24 rounded-2xl border border-neutral-200 bg-neutral-50/60" />
        <div className="h-24 rounded-2xl border border-neutral-200 bg-neutral-50/60" />
      </div>

      {/* Content panels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-2xl border border-neutral-200 bg-neutral-50/60" />
        <div className="h-64 rounded-2xl border border-neutral-200 bg-neutral-50/60" />
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
