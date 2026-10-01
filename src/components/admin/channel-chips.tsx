import type { ChannelState } from "@/lib/service-status";

/**
 * Compact channel health: one small chip per channel (Web, SMS, Reminders,
 * Booking), green working, amber not switched on, rose needs setup.
 * Channels that are off are not shown. The state is spelled out for
 * screen readers and in the tooltip, not only by color.
 */

const CHIP: Record<ChannelState, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  attention: "bg-rose-50 text-rose-700 ring-rose-200",
  off: "bg-neutral-100 text-neutral-500 ring-neutral-200",
};

const DOT: Record<ChannelState, string> = {
  active: "bg-emerald-500",
  pending: "bg-amber-500",
  attention: "bg-rose-500",
  off: "bg-neutral-300",
};

const WORD: Record<ChannelState, string> = {
  active: "working",
  pending: "not switched on",
  attention: "needs setup",
  off: "off",
};

export function ChannelChips({
  chips,
  empty = "No channels",
}: {
  chips: Array<{ key: string; label: string; state: ChannelState }>;
  empty?: string;
}) {
  if (chips.length === 0) return <span className="text-[11px] text-neutral-400">{empty}</span>;
  return (
    <ul className="flex flex-wrap items-center gap-1">
      {chips.map((c) => (
        <li
          key={c.key}
          title={`${c.label}: ${WORD[c.state]}`}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${CHIP[c.state]}`}
        >
          <span aria-hidden className={`size-1.5 rounded-full ${DOT[c.state]}`} />
          {c.label}
          <span className="sr-only">: {WORD[c.state]}</span>
        </li>
      ))}
    </ul>
  );
}

export function StateDot({ state }: { state: ChannelState }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${DOT[state]}`} />;
}
