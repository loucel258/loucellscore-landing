import { hourInZone } from "./time";

/**
 * The two Home charts (moved from the old Analytics page): when customers
 * reach out, by hour of the business's day, and what they ask about,
 * from the first customer message of each conversation.
 *
 * They only show once there is enough to read a pattern from: a handful of
 * conversations make a noisy chart that looks like a broken one.
 * Pure, no server imports.
 */

export const MIN_MESSAGES_FOR_HOURLY = 15;
export const MIN_CONVERSATIONS_FOR_TOPICS = 5;

export const TOPIC_IDS = ["booking", "pricing", "hours", "service_info", "complaint"] as const;
export type TopicId = (typeof TOPIC_IDS)[number] | "other";

const TOPIC_KEYWORDS: Record<(typeof TOPIC_IDS)[number], string[]> = {
  booking: ["book", "appointment", "schedule", "available", "cita", "agendar", "reservar", "disponib"],
  pricing: ["price", "cost", "how much", "fee", "precio", "costo", "tarifa", "cuánto", "cuanto"],
  hours: ["open", "hours", "location", "address", "abierto", "horario", "dirección", "direccion", "ubicación"],
  service_info: ["service", "treatment", "procedure", "what is", "servicio", "tratamiento", "qué es", "que es"],
  complaint: ["complaint", "problem", "issue", "refund", "queja", "problema", "reembolso"],
};

/** First topic whose keywords appear in the text, else "other". */
export function classifyTopic(text: string): TopicId {
  const lower = text.toLowerCase();
  for (const id of TOPIC_IDS) {
    if (TOPIC_KEYWORDS[id].some((k) => lower.includes(k))) return id;
  }
  return "other";
}

/** Customer messages per hour of day (0-23) in the business's zone. */
export function hourlyCounts(timestamps: string[], tz: string): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const ts of timestamps) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const h = hourInZone(d, tz);
    hours[h] = (hours[h] ?? 0) + 1;
  }
  return hours;
}

export type TopicCount = { id: TopicId; count: number };

/** Counts per topic, biggest first, "other" last; zero rows dropped. */
export function topicCounts(firstMessages: string[]): TopicCount[] {
  const counts = new Map<TopicId, number>();
  for (const text of firstMessages) {
    const id = classifyTopic(text);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => (a.id === "other" ? 1 : b.id === "other" ? -1 : b.count - a.count));
}

/** Hour with the most messages, or null when there are none. */
export function peakHour(hours: number[]): number | null {
  let best = -1;
  let bestCount = 0;
  hours.forEach((n, h) => {
    if (n > bestCount) {
      best = h;
      bestCount = n;
    }
  });
  return best >= 0 ? best : null;
}
