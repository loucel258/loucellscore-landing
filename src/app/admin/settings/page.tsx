import { Activity } from "lucide-react";
import { isAdminAuthed } from "@/lib/admin/auth";
import { AuthWall } from "@/components/admin/auth-wall";
import { getAdminSettings } from "@/lib/admin/settings";
import { getLatestCronRuns, KNOWN_CRONS } from "@/lib/ops/cron-log";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Settings — Loucells Core",
  robots: { index: false, follow: false },
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const statusStyle: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  error: "bg-rose-50 text-rose-700",
  skipped: "bg-amber-50 text-amber-700",
};

export default async function SettingsPage() {
  if (!(await isAdminAuthed())) return <AuthWall />;

  const [settings, latestRuns] = await Promise.all([getAdminSettings(), getLatestCronRuns()]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Operator config for the HQ. Changes are stored in the database, no redeploy needed.
        </p>
      </header>

      <SettingsForm initial={settings} />

      {/* Automation health — read-only */}
      <section className="mt-5 rounded-2xl border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <Activity className="size-4" /> Automation health
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          The Vercel crons and when each last ran. Times are recorded as each job finishes.
        </p>

        <div className="mt-4 overflow-hidden rounded-xl border border-white/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/60 bg-white/40 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Schedule (UTC)</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {KNOWN_CRONS.map(({ job, label, schedule }) => {
                const run = latestRuns[job];
                return (
                  <tr key={job} className="border-b border-white/40 last:border-0">
                    <td className="px-3 py-2.5 font-medium text-neutral-800">{label}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-neutral-500">
                      {schedule}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-600">
                      {run ? (
                        <span title={new Date(run.ran_at).toLocaleString()}>
                          {relativeTime(run.ran_at)}
                        </span>
                      ) : (
                        <span className="text-neutral-400">no runs yet</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {run ? (
                        <span
                          className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                            statusStyle[run.status] ?? "bg-neutral-100 text-neutral-600"
                          }`}
                        >
                          {run.status}
                        </span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="max-w-[28ch] truncate px-3 py-2.5 text-neutral-500" title={run?.summary ?? ""}>
                      {run?.summary ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">
          Schedules are defined in <code>vercel.json</code>. This panel is read-only.
        </p>
      </section>
    </main>
  );
}
