# Front Desk Agent — Architecture

> North-star architecture for the appointment/Front Desk agent (first real client:
> a nail salon). Adapted from the base spec to **this platform** — multi-tenant,
> vault-backed, audit-chained, HITL-enabled. Reconciliations vs. the generic spec
> are called out inline. Build is **phased**; see the bottom.

## 0. Guiding principle — deterministic vs LLM

| LLM does | Deterministic code does |
|---|---|
| classify intent, extract slots (date/service), draft in-session replies, **draft** (not send) review copy | availability check, appointment writes, sending reminders/reviews, payment-link generation, consent gate, quiet-hours gate, opt-out interception |

The LLM never sends proactive messages and never computes money. This is the governance pitch as code: every money/action path is deterministic, gated, and audited.

## 1. Stack (this platform)

- **Backend:** TypeScript (Next.js App Router, route handlers + cron). No new service.
- **DB:** Supabase Postgres. **Every new table gets `workspace_id` + RLS** (deny-all to anon/authenticated; service_role does all access server-side, with explicit `grant ... to service_role` — this project does NOT auto-grant; see migrations 044/046).
- **LLM (Anthropic):** Haiku 4.5 (`claude-haiku-4-5`) for intent classification; Sonnet 4.6 (`claude-sonnet-4-6`) for drafting. Opus is overkill here.
- **Channel:** SMS via Twilio Messaging Service first. WhatsApp later (needs approved templates). Twilio creds live in the **encrypted vault** (`lib/credentials/vault.ts`, provider `twilio`) — never a new keys table.
- **Payments (later phase):** Stripe; creds in the vault (provider `stripe`).

## 2. Scheduling — Postgres as system of record + Google Calendar mirror

**Decision (2026-06-21):** Postgres `appointments` is the source of truth. On every write we **mirror the event into the client's Google Calendar** so the owner sees bookings in the tool she already opens.

- `check_availability` reads Postgres `appointments` (and may read her Google Calendar for personal blocks).
- `create_appointment` writes Postgres **and** creates the Google Calendar event (read/write scope on the platform service account; she shares her calendar with it).
- **Reconciliation with shipped Phase 1:** the existing reminder cron currently reads Google Calendar and parses the phone from event text. Once `appointments` exists, the reminder reads Postgres — the phone comes from `customers`, killing the regex fragility (M1/M2 hardening becomes moot). See Phasing.

## 3. Data model

All tables: `id uuid pk`, `workspace_id text not null`, RLS on, anon revoked, service_role granted. `workspace_id` is always derived server-side from the agent — never from request input.

- **`customers`** — *(a `customers` table already exists; extend rather than recreate)*. Needs: `name`, `phone` (E.164), `timezone`, `consent_transactional bool`, `consent_marketing bool`, `opted_out bool`, `workspace_id`.
- **`services`** — `name`, `duration_min`, `price_cents`, `deposit_cents`.
- **`appointments`** — `customer_id`, `service_id`, `start_at`, `end_at`, `status`, `deposit_status`, `stripe_link_id`, `gcal_event_id` (mirror link).
- **`messages_log`** — `customer_id`, `channel`, `direction`, `body`, `template_id`, `status`, `created_at`. **TCPA evidence.** Distinct from the governance `audit_logs` chain (which logs decisions); this logs the actual messages for legal record.
- **`consent_events`** — `customer_id`, `type`, `channel`, `granted`, `source`, `timestamp`. Consent audit.
- **`templates`** — `category` (`utility|marketing`), `channel`, `twilio_content_sid`.
- **Reuse:** `appointment_reminders_sent` (idempotency ledger, already built, migration 047), the **vault** (creds), `pending_approvals` + portal (HITL), `audit_logs` (decision chain).

## 4. Tools the agent exposes (narrow interface)

```
check_availability(date_range, service_id)
create_appointment(customer_id, service_id, datetime)
reschedule_appointment(appointment_id, new_datetime)
cancel_appointment(appointment_id)
get_customer_appointments(customer_id)
answer_faq(query)                 → RAG over a small KB
generate_deposit_link(appointment_id)  → amount computed server-side from the service, never passed by the LLM
escalate_to_human(reason, context)     → wires to existing pending_approvals + portal (do NOT build new)
```

**No `send_sms` tool for proactives.** Reminders/reviews go out via the deterministic cron (`verifyCronAuth`-gated), never by LLM decision.

## 5. Hard gates (middleware, outside the LLM)

1. **Opt-out:** STOP/UNSUBSCRIBE/CANCEL/END/QUIT → Twilio Advanced Opt-Out handles it; mirror `opted_out=true` in `customers`; never reaches the LLM.
2. **Consent:** before any proactive, check `consent_marketing` (reviews/promos) or `consent_transactional` (reminders) AND `opted_out=false`.
3. **Quiet hours:** compute local time from `customers.timezone`; block proactives outside ~8am–9pm local.
4. **Money:** `generate_deposit_link` computes the amount server-side; refunds are NOT an agent tool; Stripe idempotency keys.
5. **Verified webhooks:** payment status only from a **signature-verified** Stripe webhook; inbound Twilio validated via `X-Twilio-Signature`. Never trust "I already paid." (Same pattern as the existing `/api/webhooks/cal` HMAC verify.)

## 6. Model parameters

- **Classifier:** Haiku, `temperature 0`, structured JSON output, closed intent set; low confidence → `escalate_to_human`.
- **Drafter:** Sonnet, `temperature 0.2–0.3`, system prompt with scope + refuse/escalate rules, grounded in the KB; refuses when unfounded.
- **Context:** pass **structured** client state (name, upcoming appointments, last messages), not raw history. Bounded.

## 7. Escalation thresholds (tunable)

- intent confidence < threshold
- complaint keywords / negative sentiment
- anything involving refund, dispute, or money beyond the deposit link
- N turns unresolved

Escalate = create a `pending_approval` (portal) + notify the owner + **pause the agent on that thread**.

## 8. Consent capture (the gap the base spec left open)

The salon has no booking form today (paper/WhatsApp). For TCPA you need **documented** consent before any proactive SMS. Plan:

- **Double opt-in by SMS:** when a customer is first added, the owner (or the agent on first inbound) sends one transactional confirmation that captures consent; reply YES → write a `consent_events` row + set `consent_transactional=true`. Marketing consent is a **separate** opt-in (separate checkbox/keyword), never bundled.
- Until consent exists for a customer, **no proactive goes out** (the gate blocks it). Document every grant in `consent_events`.

## 9. Non-code prerequisite (blocks sending)

Register **brand + campaign in Twilio/TCR (10DLC)** before sending anything. **Two separate use cases:** reminders (transactional) and reviews/promos (marketing). This is mandatory for US A2P SMS; sending before approval gets numbers filtered/blocked.

## 10. Build phases

1. **Reminders (shipped, interim).** Cron + Twilio + Google Calendar read. → migrate to read Postgres `appointments` once §3 exists.
2. **Data model + booking.** `customers`(extend)/`services`/`appointments` + the booking tools (check_availability, create/reschedule/cancel) + Google Calendar mirror + consent flow (§8).
3. **Reviews.** Post-appointment review request (cron) + GBP monitoring → negative review drafts to portal HITL.
4. **Deposits (Stripe).** `generate_deposit_link` + verified Stripe webhook. Last, because it adds Stripe + more 10DLC surface.

Each phase: workspace-scoped tables, vault for creds, audit on every action, HITL for anything risky.
