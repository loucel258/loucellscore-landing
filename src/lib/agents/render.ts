/**
 * Channel-specific rendering of an agent reply. Claude writes markdown by
 * habit even when told not to; a web widget can render it, but on SMS the
 * customer sees literal asterisks, pound signs and "[here](https://...)".
 *
 * renderForChannel(text, "sms"):
 *   - strips bold/italic markers (**, __, *x*), headings (#), inline code
 *     backticks and bullet markers (-, *, •) at line start
 *   - turns [label](url) into "label: url" (just "url" when they match)
 *   - keeps line breaks, collapses runs of blank lines
 *   - caps the length (~3 SMS segments) at a sentence or word boundary
 *
 * Pure function: no I/O, safe to unit test.
 */

export type Channel = "sms" | "web" | "voice";

/** ~3 GSM-7 segments. Long enough for a real answer, short enough to read. */
export const SMS_MAX_CHARS = 480;

const MD_LINK_RE = /\[([^\]\n]{1,200})\]\((\S{1,500}?)\)/g;

export function stripMarkdown(text: string): string {
  let out = text.replace(/\r\n?/g, "\n");

  // [label](url) → "label: url" (or the bare url when the label is the url).
  out = out.replace(MD_LINK_RE, (_m, label: string, url: string) => {
    const l = label.trim();
    return l && l !== url ? `${l}: ${url}` : url;
  });

  out = out
    .split("\n")
    .map((line) => {
      let l = line;
      l = l.replace(/^\s{0,3}#{1,6}\s+/, ""); // headings
      l = l.replace(/^\s*>\s?/, ""); // blockquotes
      l = l.replace(/^\s*[-*•]\s+/, ""); // bullet markers
      l = l.replace(/^\s*([-*_])(\s*\1){2,}\s*$/, ""); // horizontal rules
      return l.replace(/[ \t]+$/, "");
    })
    .join("\n");

  // Emphasis + code. Underscore emphasis only at word edges so snake_case
  // and URLs with underscores survive.
  out = out
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^\w])__(.+?)__(?=[^\w]|$)/g, "$1$2")
    .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\*\*/g, "");

  // Collapse 3+ newlines to one blank line; trim.
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Cut to `max` chars at the last sentence end, else the last word break. */
export function capAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max);

  // Last sentence terminator followed by whitespace (or the window end).
  let sentenceEnd = -1;
  const re = /[.!?](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) sentenceEnd = m.index + 1;
  if (sentenceEnd >= Math.floor(max * 0.5)) return window.slice(0, sentenceEnd).trim();

  // Leave room for the ellipsis so the result still fits in `max`.
  const room = window.slice(0, max - 3);
  const lastSpace = Math.max(room.lastIndexOf(" "), room.lastIndexOf("\n"));
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room;
  return `${cut.replace(/[\s,;:-]+$/, "")}...`;
}

export function renderForChannel(
  text: string,
  channel: Channel,
  maxChars: number = SMS_MAX_CHARS,
  locale: "en" | "es" = "en",
): string {
  if (channel === "voice") return speakableSentences(text, locale).join(" ");
  if (channel !== "sms") return text;
  return capAtBoundary(stripMarkdown(text), maxChars);
}

// ── Voice ───────────────────────────────────────────────────────────────

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
const PHONE_RE = /(?<![\d])(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?![\d])/g;

const spaced = (digits: string) => digits.split("").join(" ");

/**
 * Text as it should be spoken: no markdown, links, emojis or symbols; prices,
 * times and phone numbers written the way a person says them.
 */
export function toSpoken(text: string, locale: "en" | "es" = "en"): string {
  let out = text
    // A markdown link keeps its label; the URL is never read aloud.
    .replace(MD_LINK_RE, (_m, label: string) => label.trim())
    .replace(URL_RE, "");
  out = stripMarkdown(out)
    .replace(EMOJI_RE, "")
    // Phone numbers digit by digit, grouped (the TTS would read a big number).
    .replace(PHONE_RE, (_m, a: string, b: string, c: string) => `${spaced(a)}, ${spaced(b)}, ${spaced(c)}`)
    // Prices: $45 -> 45 dollars, $45.50 -> 45 dollars and 50 cents.
    .replace(/\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/g, (_m, whole: string, cents?: string) => {
      const n = whole.replace(/,/g, "");
      if (locale === "es") return cents && cents !== "00" ? `${n} dólares con ${Number(cents)}` : `${n} dólares`;
      return cents && cents !== "00" ? `${n} dollars and ${Number(cents)} cents` : `${n} dollars`;
    })
    // Times: 3:00 p. m. -> 3 PM, 3:30 pm -> 3:30 PM.
    .replace(/\b(\d{1,2})(?::(\d{2}))?\s?([ap])\.?\s?m\.?/gi, (_m, h: string, min: string | undefined, ap: string) =>
      `${h}${min && min !== "00" ? `:${min}` : ""} ${ap.toUpperCase()}M`,
    )
    .replace(/(\d{1,2}):00\b/g, "$1")
    .replace(/\s*&\s*/g, locale === "es" ? " y " : " and ")
    .replace(/[*_#`~<>|]/g, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out;
}

const ABBREVIATIONS = new Set(["dr", "dra", "sr", "sra", "srta", "mr", "mrs", "ms", "st", "lic", "ing", "vs", "etc", "no", "num"]);

/**
 * Index just past the first sentence in `buf`, or -1 when no sentence is
 * complete yet. A terminator counts only once the next word has started
 * (so "3 p. m." and "Dr. Lopez" are not cut in half).
 */
export function sentenceEnd(buf: string): number {
  const re = /[.!?…]+["')\]]*\s+(?=\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf)) !== null) {
    const end = m.index + m[0].length;
    const term = buf.slice(m.index, m.index + 1);
    const next = buf[end] ?? "";
    if (term === ".") {
      const before = buf.slice(0, m.index);
      const word = /([A-Za-zÁÉÍÓÚáéíóúñÑ]+)$/.exec(before)?.[1]?.toLowerCase() ?? "";
      if (word.length === 1 || ABBREVIATIONS.has(word)) continue;
      if (/\p{Ll}/u.test(next)) continue;
    }
    return end;
  }
  return -1;
}

/** Whole text -> speakable sentences (each already spoken-form). */
export function speakableSentences(text: string, locale: "en" | "es" = "en"): string[] {
  let rest = toSpoken(text, locale);
  const out: string[] = [];
  for (;;) {
    const end = sentenceEnd(`${rest} x`);
    if (end < 0 || end > rest.length) break;
    out.push(rest.slice(0, end).trim());
    rest = rest.slice(end);
  }
  if (rest.trim()) out.push(rest.trim());
  return out.filter(Boolean);
}
