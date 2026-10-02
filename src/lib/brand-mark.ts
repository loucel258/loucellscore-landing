/**
 * Loucells Core brand mark — single source of truth.
 *
 * The "governed Core": a dawn nucleus inside a bone orbit ring, with one
 * "live" agent node orbiting it, on a night rounded square (Night shift
 * palette, 2026-10). Same geometry as before; only the colors changed from
 * the retired cyan/violet/slate system.
 *
 * Used by public/logo-mark.svg AND embedded as an <img> in every next/og
 * generator (icon, apple-icon, opengraph-image) so the favicon, the tab icon,
 * and the share card all show the exact same mark.
 */
export const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Loucells Core mark">
  <defs>
    <radialGradient id="lc-core" cx="38%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#F3A06E"/>
      <stop offset="55%" stop-color="#E4773A"/>
      <stop offset="100%" stop-color="#A4460F"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="#0B0D11"/>
  <circle cx="32" cy="32" r="25" fill="none" stroke="#EEE8DD" stroke-opacity="0.18" stroke-width="1.6"/>
  <circle cx="32" cy="32" r="18.5" fill="none" stroke="#EEE8DD" stroke-opacity="0.85" stroke-width="3"/>
  <circle cx="44.4" cy="18.2" r="4.4" fill="#62D6C9"/>
  <circle cx="44.4" cy="18.2" r="4.4" fill="none" stroke="#0B0D11" stroke-width="1.4"/>
  <circle cx="32" cy="32" r="10.5" fill="url(#lc-core)"/>
</svg>`;

/** data: URI for embedding the mark in an <img> (Satori/next-og renders SVG images). */
export function brandMarkDataUri(): string {
  return `data:image/svg+xml;base64,${Buffer.from(BRAND_MARK_SVG).toString("base64")}`;
}
