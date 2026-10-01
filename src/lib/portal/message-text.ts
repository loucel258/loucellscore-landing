/**
 * Agent replies are written in light markdown (the web widget renders it),
 * but the portal and admin show them as plain text. These helpers keep the
 * owner from seeing raw `**Quote Accelerator**` in their inbox.
 *
 * Pure functions, safe on server and client. No HTML is produced: callers
 * render the segments as React text, so a message can never inject markup.
 */

/** Strip markdown syntax and collapse whitespace into one line. */
export function toPlainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** One-line preview for feeds and lists, cut at a word boundary. */
export function previewText(text: string, max = 90): string {
  const plain = toPlainText(text);
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

export type TextSegment = { text: string; bold: boolean };

/**
 * Split a full message into plain/bold segments for rendering, keeping line
 * breaks. Links become their label, bullets become "• ", headings lose `#`.
 */
export function toSegments(text: string): TextSegment[] {
  const cleaned = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
    .replace(/`([^`]+)`/g, "$1");

  const segments: TextSegment[] = [];
  const re = /(\*\*|__)(.+?)\1/g;
  let last = 0;
  for (let m = re.exec(cleaned); m; m = re.exec(cleaned)) {
    if (m.index > last) segments.push({ text: cleaned.slice(last, m.index), bold: false });
    segments.push({ text: m[2] ?? "", bold: true });
    last = m.index + m[0].length;
  }
  if (last < cleaned.length) segments.push({ text: cleaned.slice(last), bold: false });
  return segments;
}
