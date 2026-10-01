/**
 * Slug and origin helpers for the New client form. Pure functions so they
 * can be unit tested without Supabase.
 *
 * The agent slug is the client's public embed identifier and, for new
 * clients, also the portal address (/portal/<slug>). Both columns accept
 * [a-z0-9-]; the portal caps at 64 chars, so the base stays well under that
 * to leave room for a "-2" style suffix.
 */

export const SLUG_BASE_MAX = 48;

// Trailing legal-entity words that add nothing to an address.
const LEGAL_SUFFIXES = new Set([
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "pllc",
  "pa",
  "pc",
  "lp",
  "llp",
  "sa",
  "srl",
  "sas",
]);

/**
 * "Peluquería Ñandú, LLC" -> "peluqueria-nandu". Accents are folded,
 * apostrophes dropped ("Joe's" -> "joes"), legal suffixes trimmed from the
 * end, and whole words kept up to SLUG_BASE_MAX characters. Always returns
 * at least 2 characters.
 */
export function deriveSlug(businessName: string): string {
  const words = businessName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) {
    words.pop();
  }

  let slug = "";
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > SLUG_BASE_MAX) break;
    slug = next;
  }
  // A single word longer than the cap: cut it rather than return nothing.
  if (!slug && words[0]) slug = words[0].slice(0, SLUG_BASE_MAX);
  if (slug.length < 2) slug = slug ? `${slug}-client` : "client";
  return slug;
}

/** Candidate n for a base slug: 0 -> "acme", 1 -> "acme-2", 2 -> "acme-3". */
export function slugCandidate(base: string, attempt: number): string {
  return attempt <= 0 ? base : `${base}-${attempt + 1}`;
}

/**
 * Allowed origins for the chat widget from a website the owner typed:
 * "sunsetroofing.com/contact" -> ["https://sunsetroofing.com",
 * "https://www.sunsetroofing.com"]. The www/apex twin is added only for a
 * plain two-label host (or a www. host), since that is where sites usually
 * live on both. Anything that is not a usable http(s) host returns [].
 */
export function originsFromWebsite(raw: string | null | undefined): string[] {
  const value = (raw ?? "").trim();
  if (!value) return [];
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];
  if (url.username || url.password) return [];
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || /^[\d.]+$/.test(host)) return [];

  const origin = url.origin.toLowerCase();
  const out = [origin];
  const labels = host.split(".");
  const port = url.port ? `:${url.port}` : "";
  if (host.startsWith("www.") && labels.length >= 3) {
    out.push(`${url.protocol}//${host.slice(4)}${port}`);
  } else if (labels.length === 2) {
    out.push(`${url.protocol}//www.${host}${port}`);
  }
  return out;
}
