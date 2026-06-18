# Loucells Core — Design Brief

> Working document. Source of truth for visual decisions during build.

---

## 1. Brand mood (one sentence)

**Calm intelligence with traceable structure.** Premium, technical, and quietly confident — like Anthropic, Linear, and Vercel had a baby and that baby spoke Spanish.

---

## 2. Color palette — Pure White + Black + Sage

Apple-clean minimalism + sage acento. Diferenciado del SaaS-azul genérico, fresco, profesional. Sage evoca "growth + calm intelligence" — encaja con la tesis de la marca sin ser cliché.

### Light mode (default)
| Token | Hex | OKLCH | Use |
|---|---|---|---|
| `--background` | `#FFFFFF` | `oklch(1 0 0)` | Page bg — pure white |
| `--foreground` | `#0A0A0A` | `oklch(0.15 0 0)` | Primary text — near-black |
| `--muted` | `#F5F5F4` | `oklch(0.97 0.002 75)` | Card bg / subtle bands |
| `--muted-foreground` | `#57534E` | `oklch(0.42 0.008 75)` | Secondary text |
| `--border` | `#E7E5E4` | `oklch(0.92 0.003 75)` | Hairlines |
| `--primary` | `#0A0A0A` | `oklch(0.15 0 0)` | Buttons (black on white) |
| `--accent` | `#6B9080` | `oklch(0.60 0.045 155)` | Sage — CTA / glow / highlights |
| `--accent-deep` | `#344E41` | `oklch(0.35 0.045 165)` | Forest deep — hover state of sage |

### Dark mode (secondary, support only)
| Token | Hex | OKLCH | Use |
|---|---|---|---|
| `--background` | `#0A0A0A` | `oklch(0.15 0 0)` | Pure ink |
| `--foreground` | `#FAFAFA` | `oklch(0.98 0 0)` | White text |
| `--muted` | `#1C1917` | `oklch(0.20 0.003 75)` | Card bg |
| `--muted-foreground` | `#A8A29E` | `oklch(0.70 0.008 75)` | Secondary text |
| `--border` | `#292524` | `oklch(0.25 0.005 75)` | Hairlines |
| `--primary` | `#FAFAFA` | `oklch(0.98 0 0)` | Buttons (white on black) |
| `--accent` | `#84A98C` | `oklch(0.70 0.055 155)` | Sage brighter for dark |
| `--accent-deep` | `#52796F` | `oklch(0.50 0.05 160)` | Forest hover dark |

**Default mode: light.** Premium minimal aesthetic. Dark mode available as toggle.

**Accent rule:** sage aparece en **máximo 4 lugares** por página: hero glow del 3D, CTA principal (fondo sage), focus rings, 1 stat highlight. Más que eso = ruido.

**Combo signature:** pure white + pure black contrast brutal + sage como ÚNICO color → reads instantly como "premium minimal startup", muy diferenciado del azul-corporativo genérico.

---

## 3. Typography

Geist Sans + Geist Mono (already installed). No third font.

| Role | Font | Weight | Size (desktop) | Line-height | Tracking |
|---|---|---|---|---|---|
| Display (hero) | Geist Sans | 600 | 80–96px clamp | 1.0 | `-0.04em` |
| H1 section | Geist Sans | 600 | 48–56px clamp | 1.05 | `-0.03em` |
| H2 | Geist Sans | 600 | 32–40px | 1.1 | `-0.02em` |
| H3 | Geist Sans | 500 | 22–24px | 1.2 | `-0.01em` |
| Body | Geist Sans | 400 | 18px | 1.6 | `-0.005em` |
| Small | Geist Sans | 400 | 14px | 1.5 | `0` |
| Eyebrow / labels | Geist Mono | 500 | 12px | 1.4 | `0.08em` uppercase |
| Code / numbers | Geist Mono | 400 | inherit | inherit | `0` |

**Rules:**
- Hero copy uses tight negative tracking → looks premium, NOT bloggy.
- Eyebrows in Geist Mono uppercase → Anthropic/Linear hallmark.
- Body 18px minimum on desktop, 16px mobile (not 14px — feels cheap).

---

## 4. 3D hero concept — chosen: **"Constellation of Agents"**

A slow-rotating 3D scene: **15–25 glowing nodes** floating in space, connected by traceable light paths. Three "layer planes" of nodes at different depths suggest the governance architecture. Camera does subtle parallax on mouse move. On scroll, the constellation slowly drifts and one node "lights up" cycling through, suggesting a request being traced across agents.

**Why this concept won:**
- **Reads instantly** as AI/intelligence (neural network metaphor is universal).
- **Reinforces the positioning:** multiple agents + governance + traceability — all visible.
- **Mobile fallback is trivial:** static beautiful render of the same scene.
- **Performance is manageable:** instanced geometry, no expensive shaders required.
- **Mouse tracking feels natural:** nodes lean toward cursor, camera orbits 3–5°.
- **Cinematic on scroll:** different camera angles per section transition.

**Technical stack:** Three.js + R3F + `@react-three/drei` (for postprocessing bloom) + `@react-three/postprocessing`. Mobile: detect with `useMediaQuery`, swap to static `<img>` of pre-rendered scene.

**Anti-pattern to avoid:** Spline embeds (heavy iframe, no SSR), particle storms (cliché), aurora gradients alone (too "generic SaaS").

---

## 5. Section-by-section structure

```
1. NAV (sticky, transparent on hero, frosted on scroll)
   - Wordmark | Services | Pricing | About | Lang toggle | Book a call (CTA)

2. HERO — 100vh
   - Eyebrow (mono): "Bilingual web & AI studio"
   - Massive headline (3 lines max)
   - Subtitle (2 lines)
   - Primary CTA + secondary
   - Background: Constellation 3D, behind text, opacity 70%
   - Trust line at bottom: "For US small businesses in [icons]"
   - Mouse: camera parallax 3°, nodes lean

3. SERVICES INTRO — 80vh
   - Eyebrow: "What we do"
   - Big statement: "Two lines, one outcome: more revenue, less friction."
   - Split visual: left = "WEB FOUNDATION", right = "AI AGENTS" — pinned on scroll, fades in
   - Subtitle explaining the funnel

4. WEB FOUNDATION — multi-step scroll
   - Section pin (GSAP ScrollTrigger)
   - 4 cards reveal one by one as you scroll: Landing Build / Redesign / SEO Audit / SEO+GEO
   - Each card: name, price, 2-line desc, "Learn more" mini-CTA
   - Background image: subtle wireframe of a website morphing

5. AI AGENTS — multi-step scroll (mirrors web section)
   - 3 cards: Front Desk / Quote Accelerator / Review Manager
   - Background: small 3D agent node activating per card
   - Highlight: "Built on Claude (Anthropic)" small badge

6. WHY US — 4 columns grid
   - Bilingual / Real engineering / Outcomes not hours / We use what we sell
   - Each: mono number "01–04", title, 2-line desc
   - Static, just fade-in on scroll

7. PROCESS — horizontal timeline (or vertical on mobile)
   - 4 steps with mono numbers
   - Subtle connecting line that draws as you scroll

8. CTA — full-bleed
   - Constellation 3D returns, brighter
   - Massive question: "Ready to stop leaving money on the table?"
   - Single big CTA: "Book a 30-min call"
   - Calendly opens in modal

9. FOOTER — minimal
   - 3 columns: brand+tagline | nav links | contact + social
   - Bottom: ©2026 Loucells Core · All rights reserved · Email
```

---

## 6. Motion principles

- **Easing:** `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-expo) for entries. `cubic-bezier(0.7, 0, 0.84, 0)` for exits.
- **Duration:** 600–800ms for hero/section entries. 200–300ms for micro (hover, CTA). Never linear.
- **Scroll:** Lenis for smooth scroll (lerp 0.1). Disabled on `prefers-reduced-motion`.
- **Pinned sections:** maximum 2 per page (Web Foundation, AI Agents). Otherwise scroll fatigue.
- **Reveals:** stagger 50–80ms per item. Never all-at-once, never >150ms (feels slow).
- **3D:** rotation always slow (0.2 rad/s max). Camera parallax 3° max — anything more = motion sickness.
- **What does NOT animate:** body text typography (no typewriter), prices (instant), CTAs (only hover state).

---

## 7. Reference sites (look at these before building)

1. **anthropic.com** — restraint, mono labels, generous whitespace, warm neutrals
2. **linear.app** — cinematic scroll, parallax depth, micro-precision
3. **vercel.com** — pure monochrome confidence, code-aesthetic
4. **resend.com** — premium developer tool, perfect Geist usage
5. **railway.com** — playful 3D + serious copy balance

---

## 8. Anti-patterns (NEVER do these)

- ❌ Stock photos of business people shaking hands
- ❌ Generic "AI brain" illustrations / blue gradient blobs
- ❌ Emojis as section icons (use Lucide)
- ❌ Lottie files for hero — too cliché now
- ❌ "AI-powered" anywhere in copy (Anthropic doesn't even say "AI", they say "Claude")
- ❌ Testimonials with fake avatars (no testimonials > fake ones)
- ❌ "Trusted by" logos when we have 0 clients yet
- ❌ Carousels of any kind
- ❌ Animated typing of the hero text (cliché, hurts FCP)
- ❌ Parallax on images at >20% movement (motion sick)
- ❌ Section dividers with diagonal SVGs (2017 trend)
- ❌ More than 1 accent color
- ❌ Pure black `#000` or pure white `#FFF` — always warm-tinted

---

## 9. Logo direction (placeholder until designed)

- Wordmark only: "Loucells Core" in Geist Sans 600, tight tracking
- Optional mark: a single glowing dot or 3-node mini-constellation to the left
- No icon font, no SVG yet — pure type until we design

---

## Next steps after this brief

1. Apply colors + typography to `globals.css` and `tailwind.config`
2. Install Three.js stack + GSAP + Lenis
3. Build Constellation 3D component
4. Build sections in order: Hero → Services Intro → Web Foundation → AI Agents → Why Us → Process → CTA → Footer
5. Polish pass with `impeccable` skill
