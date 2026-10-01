import Link from "next/link";
import type { ReactNode } from "react";

/**
 * EmptyState — diseñado como demo de "lo que aparece cuando hay data".
 *
 * Critical for Loucells Core pre-launch: half the pages are empty for a while.
 * Each empty state should explain what the page does + next action.
 */
export function EmptyState({
  icon,
  title,
  description,
  cta,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-12 text-center">
      {icon && (
        <span className="flex size-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
          {icon}
        </span>
      )}
      <div className="max-w-sm">
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        {description && (
          <p className="mt-1 text-xs text-neutral-500">{description}</p>
        )}
      </div>
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-700"
        >
          {cta.label} →
        </Link>
      )}
    </div>
  );
}
