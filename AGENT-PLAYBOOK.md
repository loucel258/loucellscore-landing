# AGENT PLAYBOOK — Loucells Core

**For:** Steven Estrada
**Date:** 2026-05-25
**Mode:** Commercial push + Trust Stack hardening
**Source:** Chief of Staff agent recommendation, reviewed by Claude

---

## 1. Commercial push — the 5 agents that close the first deals

You don't need a fleet. You need a closing crew. Pick these and use them on a fixed cadence.

**1. Proposal Strategist — once per qualified lead (weekly while pipeline < 5).**
Deliverable: a tailored win narrative per prospect that maps Trust Stack capabilities (DLP, RBAC, Audit, HITL) to that buyer's specific risk language. Your sales toolkit is generic right now; it needs to become situational. This is the agent that turns a $20K conversation into a $45K one.

**2. Executive Summary Generator (SCQA / Pyramid) — once per proposal.**
Deliverable: the 1-page exec summary that sits on top of every SOW. SMB owners in construction/hospitality don't read 12-page proposals. They read page one. SCQA is the right frame: Situation (you have AI risk), Complication (no controls), Question (how do you deploy safely?), Answer (Trust Stack, owned by you, Florida-based). Pair with Proposal Strategist output.

**3. Financial Analyst — once, then on demand.**
Deliverable: a reusable pricing/ROI model per vertical (construction, prof services, hospitality) showing build fee + retainer payback in months. You're selling a recurring-revenue motion — the buyer needs to see their own ROI math, not yours. This unlocks the retainer conversation and protects you from "buy once" pressure (per your Loucel revenue model memory).

**4. Legal Document Review — before first signed deal, then quarterly.**
Deliverable: pressure-test your MSA/SOW templates against the new positioning (SMV, Florida, Owned by You). Your toolkit predates the current security backbone. A buyer's lawyer will find the gaps before you do. One pass now saves a deal later.

**5. Analytics Reporter — bi-weekly starting now.**
Deliverable: a 1-page KPI sheet — landing page conversions, demo completions per Trust Stack pillar, lead source attribution. You're flying blind on which of the 4 demos actually converts. This is the cheapest agent to run and the one that tells you where to point everything else.

**Cadence summary:** Proposal Strategist + Exec Summary fire together per lead. Financial Analyst builds once, reused per deal. Legal runs once now, again at deal #3. Analytics every two weeks, Friday close.

---

## 2. Engineering — 3 rules, no bureaucracy

1. **Every change under `/api/demo/*`, `/api/auth/*`, or `supabase/migrations/*` runs through Code Reviewer before merge.** No exceptions. This is your security perimeter — you just closed 14 P0/P1 issues, don't reopen them by hand.
2. **Any new public route or LLM call goes through Plan first, then Minimal Change Engineer for the diff.** Plan keeps scope honest, MCE keeps the diff surgical. This combination prevents "while I'm here" sprawl.
3. **Explore before edit on any file you haven't touched in 7 days.** One grep, one read — not a re-audit. Matches your efficiency rule.

That's it. Three rules. No PR template, no checklist theater.

---

## 3. Agents to ignore right now

- **MCP Builder** — premature. You have no customer asking for an MCP integration. Revisit at deal #5.
- **Tax Strategist / Bookkeeper & Controller** — you're pre-revenue on Loucells Core. A CPA at year-end is cheaper than agent loops on books that don't exist yet.
- **The full SEO sub-fleet** — you have a landing page with 4 demos and no domain yet. SEO is a Q3 problem. Buy the domain, ship to Vercel, then revisit one SEO agent (technical) — not the fleet.
- **Paid-ads sub-fleet** — same logic. You have no conversion data. Running audit-meta or audit-google now spends money to learn what Analytics Reporter will tell you for free in two weeks.

The pattern: don't hire specialists for problems you don't have yet.

---

## 4. The high-leverage move this week

**Run Financial Analyst to build a 3-vertical ROI calculator (construction / professional services / hospitality), then have Proposal Strategist wrap it into a "Trust Stack ROI Brief" you can send cold.**

Why this is the highest-EV move:
- It's the missing artifact between your landing page (awareness) and your SOW (commitment). You have nothing in the middle right now.
- It converts the security work you just shipped into a buyer-facing number, which is what SMB owners actually decide on.
- It's reusable across every lead — build once, deploy 20 times.
- It unblocks the retainer conversation, which is where your real revenue lives.

Everything else on the pending list (hero images, Cal.com, Vercel deploy, domain) is logistics. This is the asset that makes the logistics matter.

---

## Closing read

Your engineering posture is strong. Your commercial posture is thin. Spend the next two weeks routing 70% of agent time at commercial, 30% at engineering hygiene. Flip the ratio after deal #2.
