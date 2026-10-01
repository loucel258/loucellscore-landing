import { BarChart3, MessageCircleQuestion } from "lucide-react";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { MIN_CONVERSATIONS_FOR_TOPICS, MIN_MESSAGES_FOR_HOURLY, peakHour } from "@/lib/portal/insights";
import { topicLabel } from "@/lib/portal/labels";
import { t, tn, type PortalLang } from "@/lib/portal/strings";
import { portalLocale } from "@/lib/portal/time";
import type { InsightsData } from "@/lib/portal/home-data";

/** "9 AM" / "9 a. m." for an hour of the business's day. */
function hourLabel(h: number, lang: PortalLang): string {
  return new Date(Date.UTC(2020, 0, 1, h)).toLocaleTimeString(portalLocale(lang), { hour: "numeric", timeZone: "UTC" });
}

/**
 * The two pattern charts at the bottom of Home (they used to be the
 * Analytics page). Each one renders only with enough data to mean
 * something; with neither, nothing renders (the #insights anchor stays so
 * old /analytics links still land on Home).
 */
export function Insights({ data, lang }: { data: InsightsData; lang: PortalLang }) {
  const showHourly = data.customerMessages >= MIN_MESSAGES_FOR_HOURLY;
  const showTopics = data.classified >= MIN_CONVERSATIONS_FOR_TOPICS;
  if (!showHourly && !showTopics) return <div id="insights" />;

  const max = Math.max(...data.hourly, 1);
  const peak = peakHour(data.hourly);

  return (
    <section id="insights" className="scroll-mt-20 space-y-3">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-neutral-500">{t(lang, "home.insights_eyebrow")}</p>
      <PanelGrid cols={showHourly && showTopics ? 2 : 1}>
        {showHourly && (
          <Panel
            title={t(lang, "analytics.hourly_title")}
            eyebrow={t(lang, "analytics.hourly_desc")}
            icon={<BarChart3 className="size-4" />}
          >
            <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={peak !== null ? t(lang, "home.peak_hour", { hour: hourLabel(peak, lang) }) : undefined}>
              {data.hourly.map((v, h) => (
                <div
                  key={h}
                  className={`flex-1 rounded-t ${h === peak ? "bg-cyan-600" : "bg-violet-300"}`}
                  style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
                  title={`${hourLabel(h, lang)} · ${tn(lang, "inbox.messages", v)}`}
                />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-neutral-500">
              {[0, 6, 12, 18].map((h) => (
                <span key={h}>{hourLabel(h, lang)}</span>
              ))}
              <span aria-hidden />
            </div>
            {peak !== null && (
              <p className="mt-3 text-xs font-medium text-neutral-700">{t(lang, "home.peak_hour", { hour: hourLabel(peak, lang) })}</p>
            )}
          </Panel>
        )}

        {showTopics && (
          <Panel
            title={t(lang, "analytics.topics_title")}
            eyebrow={t(lang, "analytics.topics_desc")}
            icon={<MessageCircleQuestion className="size-4" />}
          >
            <ul className="space-y-2.5">
              {data.topics.map((tc) => {
                const pct = data.classified > 0 ? (tc.count / data.classified) * 100 : 0;
                return (
                  <li key={tc.id}>
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className={`font-medium ${tc.id === "other" ? "text-neutral-500" : "text-neutral-800"}`}>
                        {topicLabel(lang, tc.id)}
                      </span>
                      <span className="tabular-nums text-neutral-500">
                        {tc.count} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className={`h-full ${tc.id === "other" ? "bg-neutral-400" : "bg-cyan-500"}`}
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </PanelGrid>
    </section>
  );
}
