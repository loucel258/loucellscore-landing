"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { formatUsdInt } from "@/lib/admin/format";

export type TrendPoint = { month: string; mrr: number };
export type BreakdownPoint = { name: string; value: number; color: string };
export type TopClient = { name: string; mrr: number };

export function RevenueCharts({
  trend,
  breakdown,
  topClients,
}: {
  trend: TrendPoint[];
  breakdown: BreakdownPoint[];
  topClients: TopClient[];
}) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
      {/* MRR trend, 12 months */}
      <section className="rounded-xl border border-white/60 bg-white/52 shadow-sm shadow-slate-900/10 p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            12-month MRR trend
          </h2>
          <span className="text-[10px] text-neutral-400">end-of-month</span>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={trend}
              margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
            >
              <defs>
                <linearGradient id="mrrGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="2 4"
                stroke="rgba(148,163,184,0.2)"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                stroke="#94A3B8"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#94A3B8"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
                }
                width={48}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  border: "1px solid #E5E7EB",
                  borderRadius: 6,
                  padding: "6px 10px",
                }}
                formatter={(value) => [
                  formatUsdInt(typeof value === "number" ? value : 0),
                  "MRR",
                ]}
              />
              <Area
                type="monotone"
                dataKey="mrr"
                stroke="#06B6D4"
                strokeWidth={2.5}
                fill="url(#mrrGradient)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Breakdown donut + Top 5 clients */}
      <div className="flex flex-col gap-6">
        <section className="rounded-xl border border-white/60 bg-white/52 shadow-sm shadow-slate-900/10 p-5">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Quarter revenue mix
          </h2>
          {breakdown.length === 0 ? (
            <p className="text-xs italic text-neutral-400">
              No quarterly revenue yet.
            </p>
          ) : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={breakdown}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={36}
                    outerRadius={58}
                    paddingAngle={3}
                    stroke="#fff"
                    strokeWidth={2}
                  >
                    {breakdown.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Legend
                    iconSize={8}
                    wrapperStyle={{ fontSize: 10, color: "#64748B" }}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      border: "1px solid #E5E7EB",
                      borderRadius: 6,
                      padding: "6px 10px",
                    }}
                    formatter={(value) => [
                      formatUsdInt(typeof value === "number" ? value : 0),
                      "",
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-white/60 bg-white/52 shadow-sm shadow-slate-900/10 p-5">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Top clients by MRR
          </h2>
          {topClients.length === 0 ? (
            <p className="text-xs italic text-neutral-400">
              No active retainers yet.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {topClients.map((c, i) => (
                <li
                  key={c.name}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="flex items-center gap-2">
                    <span className="size-5 rounded bg-neutral-100 text-center text-[10px] font-semibold tabular-nums leading-5 text-neutral-600">
                      {i + 1}
                    </span>
                    <span className="truncate text-neutral-800">{c.name}</span>
                  </span>
                  <span className="tabular-nums text-emerald-700">
                    {formatUsdInt(c.mrr)}/mo
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
