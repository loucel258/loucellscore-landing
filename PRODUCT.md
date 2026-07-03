# Product

## Register

product

## Users

Two distinct audiences share this codebase:

1. **Client portal (`/portal/[slug]`)**: owners of US service SMBs (medspas,
   dental clinics, contractors, salons) who hired Loucels to run an AI agent
   for their business. They are NOT technical. Many are bilingual EN/ES;
   the portal ships both languages (EN default). They check the portal from
   phone and desktop in roughly equal measure: quick phone glances between
   customers ("did the agent book anyone today?") and longer desktop sessions
   reviewing conversations and approving actions. Their job to be done:
   confirm the agent is making them money, intervene when something needs a
   human, and feel in control of an automation they don't fully understand.

2. **Admin (`/admin`)**: Steven, the operator. Dense data, fast workflows,
   no hand-holding needed.

The marketing site (`/[locale]`) is brand register and out of scope for this
file's defaults.

## Product Purpose

Loucels deploys done-for-you AI agents (front desk, booking, escalation) for
service SMBs, wrapped in a governance layer (audit chain, DLP, human-in-the-
loop approvals, budget caps) called the Trust Stack. The portal is where the
client SEES that value: ROI metrics, live conversations, approval queue,
their integrations, the embed snippet. The portal protects the monthly
retainer; if the client stops feeling the value, they churn. Success = the
client opens the portal, understands in seconds that the agent worked for
them today, and trusts it enough to keep paying.

## Brand Personality

Premium concierge with command-center confidence. Three words: **trustworthy,
effortless, in-control**. The client should feel both "someone is taking care
of my business" (concierge warmth, executive-report clarity) and "I can see
and steer everything" (live data, take-over controls, approval queue). Calm
surfaces, confident numbers, zero jargon. Spanish copy is first-class, never
a translation afterthought.

## Anti-references

- Generic SaaS dashboard slop: hero-metric cards in identical grids, gradient
  text, decorative glass with no system. (The admin/portal shell IS a
  deliberate glass system — blue gradient + one opacity scale, documented in
  DESIGN.md. Random per-component blurs/opacities outside that scale are the
  anti-reference.)
- Intercom/HighLevel visual noise: 40 widgets competing for attention.
- "AI product" clichés: sparkle emojis, purple-on-black neon, robot mascots.
- Compliance overclaiming: never imply SOC 2 certification or guarantees the
  contract doesn't make.
- Developer-tool austerity (Linear's density is right for the admin, wrong
  for the client portal).

## Design Principles

1. **Money first, mechanics second.** Every portal screen leads with the
   business outcome (leads, bookings, hours saved); how the agent did it is
   one tap deeper.
2. **Control is a feature.** Take-over, approvals, and pause must always be
   visible and reachable; that visible steering wheel is what justifies the
   retainer.
3. **Trust through transparency, not claims.** Show the audit trail, the
   sources, the "why" — never just assert "secure" or "compliant".
4. **One glance, one answer.** Each screen answers exactly one question the
   owner actually asks ("did it work today?", "does anything need me?").
5. **Both thumbs and big screens.** Every workflow must complete cleanly on
   a phone; density upgrades are a desktop bonus, not a requirement.

## Accessibility & Inclusion

- Bilingual EN/ES parity for all client-facing copy (en default, per-client
  preference stored).
- Non-technical users: no jargon, no unexplained technical states.
- Touch targets ≥44px on portal interactive elements; forms usable with one
  thumb.
- WCAG AA contrast as the floor; respect prefers-reduced-motion.
