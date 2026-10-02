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

export type Channel = "sms" | "web";

/** ~3 GSM-7 segments. Long enough for a real answer, short enough to read. */
export const SMS_MAX_CHARS = 480;

const MD_LINK_RE = /\[([^\]\n]{1,200})\]\((\S{1,500}?)\)/g;

function stripMarkdown(text: string): string {
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

export function renderForChannel(text: string, channel: Channel, maxChars: number = SMS_MAX_CHARS): string {
  if (channel !== "sms") return text;
  return capAtBoundary(stripMarkdown(text), maxChars);
}
