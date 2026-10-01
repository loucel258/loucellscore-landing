/**
 * HTML helpers for customer-facing emails sent from the portal. The body
 * text is LLM- or visitor-influenced, so it is always escaped before any
 * markup (line breaks) is added.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Escaped text with line breaks as <br>, wrapped in the email container. */
export function textToEmailHtml(text: string): string {
  const body = escapeHtml(text).replace(/\r?\n/g, "<br>");
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;line-height:1.55;color:#111">${body}</div>`;
}

/** One-line value safe for an email subject (no header injection). */
export function subjectSafe(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim().slice(0, 120);
}
