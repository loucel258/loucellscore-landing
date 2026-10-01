/** Account lifecycle pill (crm_accounts.lifecycle). */

const LIFECYCLE_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  prospect: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
  dormant: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  churned: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-300",
};

export function LifecycleBadge({ lifecycle }: { lifecycle: string | null }) {
  if (!lifecycle) {
    return (
      <span className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 ring-1 ring-neutral-300">
        No account
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        LIFECYCLE_TONE[lifecycle] ?? LIFECYCLE_TONE.prospect
      }`}
    >
      {lifecycle}
    </span>
  );
}
