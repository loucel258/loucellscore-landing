# Deployment

## Quick deploy to Vercel

```bash
# From /landing/ directory
vercel
```

First time: link to a Vercel project, then deploy. Subsequent: `vercel --prod`.

## Required environment variables

Set these in Vercel dashboard (Settings → Environment Variables) for the **production** environment:

| Variable | Example | Notes |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://loucellscore.com` | No trailing slash. Used for canonical URLs, sitemap, OG. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `contact@loucellscore.com` | Footer, legal, mailto links. |
| `NEXT_PUBLIC_CAL_URL` | `https://cal.com/loucellscore/30min` | Booking link in CTAs. |

For local development copy `.env.example` to `.env.local` and adjust.

## Domain setup

1. Buy `loucellscore.com` (or whichever final name).
2. In Vercel: Settings → Domains → Add `loucellscore.com` and `www.loucellscore.com`.
3. Update DNS at registrar:
   - Apex `@` → A record to `76.76.21.21`
   - `www` → CNAME to `cname.vercel-dns.com`
4. Set `loucellscore.com` as primary (www → apex redirect).
5. Update `NEXT_PUBLIC_SITE_URL` env var to match final domain.
6. Redeploy.

## Pre-launch checklist

- [ ] Replace placeholder Cal.com URL (`cal.com/loucellscore/30min`) with real one
- [ ] Set up Google Search Console — verify with DNS TXT or HTML file
- [ ] Submit sitemap: `https://loucellscore.com/sitemap.xml`
- [ ] Set up Google Business Profile (if local presence)
- [ ] Replace `/public/og-default.png` (1200×630) — currently missing, create one
- [ ] Replace `/public/favicon.ico` — currently default Next.js
- [ ] Add real social links to footer (LinkedIn, X, GitHub)
- [ ] Test bilingual EN/ES on production URL
- [ ] Run Lighthouse — target ≥85 Performance, 100 SEO/A11y
- [ ] Verify structured data with `https://search.google.com/test/rich-results`
- [ ] Test middleware redirect on root `/`
- [ ] Verify 404 page at `/some-random-route`
- [ ] Verify legal pages at `/en/privacy`, `/es/terms`

## Analytics setup (optional, when ready)

Uncomment the env vars in `.env.example` for Plausible or PostHog, then add the script in `src/app/[locale]/layout.tsx` body.

## Routes generated

| Route | Notes |
|---|---|
| `/` | Redirects to `/en` or `/es` via middleware |
| `/[locale]` | Homepage (en, es) |
| `/[locale]/services` | Services index |
| `/[locale]/services/[slug]` | 7 service detail pages × 2 locales = 14 |
| `/[locale]/privacy` | Privacy policy |
| `/[locale]/terms` | Terms of service |
| `/robots.txt` | Auto-generated |
| `/sitemap.xml` | Auto-generated with all routes + hreflang |

Total static pages: ~22 (excluding sitemap/robots).
