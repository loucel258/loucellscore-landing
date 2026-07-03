# Design

Scope: the authenticated shell (`/admin` + `/portal/[slug]`). The marketing
site (`/[locale]`) is brand register with its own dark slate system in
`globals.css`; do not apply these tokens there.

## The glass shell system (2026-06, deliberate)

One backdrop, one dark chrome, one light content panel:

- **Backdrop**: fixed blue gradient
  `bg-gradient-to-b from-[#1f3d77] via-[#3a5ea0] to-[#c2d6f1]`.
  Both layouts and both login shells use exactly this. Never introduce a
  second gradient.
- **Chrome (sidebar / mobile bars)**: dark translucent slate.
  Sidebar `bg-slate-950/35 backdrop-blur-2xl border-white/10`;
  mobile bars `bg-slate-950/60 backdrop-blur-xl`; mobile drawer
  `bg-slate-950/90 backdrop-blur-xl`.
- **Content panel**: `rounded-3xl border-white/60 bg-white/45` +
  the big soft shadow. **No backdrop-blur on the panel** — nothing scrolls
  behind it, blur there is pure GPU cost (mobile Safari pays it).

## Opacity scale (white surfaces on the panel)

| Tier | Class | Use |
|---|---|---|
| Card | `bg-white/55` + `border-white/60` | default card, table container, list item |
| Panel-nested | `bg-white/40` | rows/wells inside a card |
| Subtle | `bg-white/25` | footers, quiet strips |
| Control / dense-data | `bg-white/70`–`/72` + `border-white/70` | form inputs, buttons, chat-pulse data tables (deliberate contrast bump) |

Hover states may float between tiers (e.g. `hover:bg-white/85`). Never plain
`bg-white` or `hover:bg-white` inside the shell.

Canonical card recipe:
`rounded-lg border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10`.
Hero surfaces (HeroCard and clones):
`rounded-3xl border-white/65 bg-gradient-to-br from-white/70 via-cyan-100/30 to-violet-100/30 shadow-sm shadow-slate-900/10`.

## Palette rule

- **Shell chrome = slate** (`text-slate-100/200/300/400` on dark glass;
  `text-slate-700` on the panel footer).
- **Content on white-ish cards = neutral** (`text-neutral-900/700/600`).
- Contrast floor on glass: informational text ≤11px uses `neutral-600` or
  darker (`neutral-500` fails AA over the gradient). Internal dividers and
  table header borders inside white/55 cards stay `border-neutral-200` —
  a white divider on a white surface is invisible; that is intentional,
  not drift.
- Accents: cyan (brand/active), violet (secondary), emerald (good),
  amber (attention), rose (critical). Accent borders only as state
  (e.g. approval risk), not decoration.

## Blur budget

`backdrop-blur` only where content actually scrolls or layers behind the
element: sidebar (identity), sticky TopBar (`backdrop-blur-xl`), mobile
bars/drawer. Nowhere else. Every new blur must justify itself against
mobile Safari.

## Type

Inter everywhere in the shell (no display font in UI). Tabular nums for all
metrics. Micro-labels: `text-[10px] uppercase tracking-wider` in
`text-neutral-600` (on cards) or `text-slate-400` (on dark chrome).
