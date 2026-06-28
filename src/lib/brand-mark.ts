/**
 * Loucells Core brand mark — single source of truth.
 *
 * The "governed Core": a glowing nucleus (cyan→violet) inside a bold orbit
 * ring, with one agent node orbiting it, on a slate rounded square. Evolves
 * the original dot+faint-rings mark so the rings actually survive at favicon
 * size (the old 1px / 0.25-opacity rings vanished at 16px).
 *
 * Used by public/logo-mark.svg AND embedded as an <img> in every next/og
 * generator (icon, apple-icon, opengraph-image) so the favicon, the tab icon,
 * and the share card all show the exact same mark.
 */
export const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Loucells Core mark">
  <defs>
    <radialGradient id="lc-core" cx="38%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#5EEAF7"/>
      <stop offset="45%" stop-color="#22D3EE"/>
      <stop offset="78%" stop-color="#8B5CF6"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </radialGradient>
    <linearGradient id="lc-ring" x1="14" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#22D3EE"/>
      <stop offset="100%" stop-color="#8B5CF6"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="#0F172A"/>
  <circle cx="32" cy="32" r="25" fill="none" stroke="#8B5CF6" stroke-opacity="0.30" stroke-width="1.6"/>
  <circle cx="32" cy="32" r="18.5" fill="none" stroke="url(#lc-ring)" stroke-width="3"/>
  <circle cx="44.4" cy="18.2" r="4.4" fill="#5EEAF7"/>
  <circle cx="44.4" cy="18.2" r="4.4" fill="none" stroke="#0F172A" stroke-width="1.4"/>
  <circle cx="32" cy="32" r="10.5" fill="url(#lc-core)"/>
</svg>`;

/** data: URI for embedding the mark in an <img> (Satori/next-og renders SVG images). */
export function brandMarkDataUri(): string {
  return `data:image/svg+xml;base64,${Buffer.from(BRAND_MARK_SVG).toString("base64")}`;
}
