/**
 * Post-login redirect target for /admin/login?next=...
 *
 * `next` is attacker-controllable (anyone can send Steven a crafted login
 * link), and the login form assigns it to window.location.href. Without a
 * check, `?next=https://evil.example` is an open redirect and
 * `?next=javascript:...` runs script on our origin. Only same-origin paths
 * under /admin are accepted; anything else falls back to the dashboard.
 */

export const ADMIN_DEFAULT_PATH = "/admin/dashboard";

// Whitespace, control chars and backslashes are rejected outright: browsers
// strip or reinterpret them while parsing URLs ("/\evil.com" is
// protocol-relative in some parsers).
const UNSAFE_CHARS = /[\s\u0000-\u001F\u007F\\]/;
const ADMIN_PATH = /^\/admin(?:[/?#]|$)/;

export function safeAdminNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
    return ADMIN_DEFAULT_PATH;
  }
  if (raw.startsWith("//") || UNSAFE_CHARS.test(raw)) return ADMIN_DEFAULT_PATH;
  if (!ADMIN_PATH.test(raw)) return ADMIN_DEFAULT_PATH;
  return raw;
}
