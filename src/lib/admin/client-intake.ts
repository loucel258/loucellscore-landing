import { z } from "zod";
import { originsFromWebsite } from "./slug";

/**
 * Shared, client-safe pieces of the New client flow: the option lists the
 * form renders, the input schema the route validates, the engagement
 * reference format, and the step report the route returns. The server
 * side lives in provision.ts.
 */

export const AGENT_TYPES = [
  "ai_front_desk",
  "quote_accelerator",
  "review_manager",
  "operations_gap_audit",
  "custom",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  ai_front_desk: "AI Front Desk",
  quote_accelerator: "Quote Accelerator",
  review_manager: "Review Manager",
  operations_gap_audit: "Operations Gap Audit",
  custom: "Custom",
};

export const VERTICALS = [
  "medspa",
  "salon",
  "dental",
  "roofing",
  "hvac",
  "plumbing",
  "restaurant",
  "hospitality",
  "wealth",
  "legal",
  "other",
] as const;

const PHONE_RE = /^[+0-9 ().-]{7,30}$/;

export const NewClientInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  businessName: z.string().trim().min(2).max(200),
  ownerName: z.string().trim().min(1).max(200),
  ownerEmail: z.string().trim().email().max(200),
  ownerPhone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === "" || PHONE_RE.test(v), "Phone: digits, spaces, + ( ) - only")
    .optional(),
  language: z.enum(["en", "es"]),
  vertical: z.enum(VERTICALS),
  agentType: z.enum(AGENT_TYPES),
  website: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || originsFromWebsite(v).length > 0, "Website must be a domain like example.com")
    .optional(),
});
export type NewClientInput = z.infer<typeof NewClientInputSchema>;

/** First letter of each word, A-Z0-9 only, max 4 (same as bin/new-engagement.sh). */
export function engagementInitials(clientName: string): string {
  return clientName
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
}

/**
 * Engagement reference: OGA-YYYYMMDD-INIT for audits (the existing
 * convention), BLD-YYYYMMDD-INIT-TAG for agent builds from the New client
 * form, where TAG comes from the form's idempotency key. engagement_ref is
 * unique in the database, so a resubmitted form can never create a second
 * engagement: the insert collides and the route picks up the first one.
 */
export function buildEngagementRef(
  clientName: string,
  opts: { prefix?: "OGA" | "BLD"; date?: Date; tag?: string } = {},
): string {
  const date = (opts.date ?? new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  const initials = engagementInitials(clientName) || "XXXX";
  return `${opts.prefix ?? "OGA"}-${date}-${initials}${opts.tag ? `-${opts.tag}` : ""}`;
}

/** 8 hex chars of the (random v4) idempotency key, uppercased. */
export function idempotencyTag(key: string): string {
  return key.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export type ProvisionStepName = "account" | "engagement" | "agent" | "portal";

export type ProvisionStep = {
  step: ProvisionStepName;
  status: "created" | "reused" | "failed" | "skipped";
  id?: string;
  detail?: string;
};

export type ProvisionResponse = {
  ok: boolean;
  steps: ProvisionStep[];
  failedStep?: ProvisionStepName;
  error?: string;
  detail?: string;
  accountId?: string;
  engagementId?: string;
  engagementRef?: string;
  agentId?: string;
  agentSlug?: string;
  portalSlug?: string;
  /** Present only when this call created the portal. Never stored. */
  passcode?: string;
  clientHref?: string;
};

export const STEP_LABELS: Record<ProvisionStepName, string> = {
  account: "Client account",
  engagement: "Engagement",
  agent: "Agent",
  portal: "Portal access",
};
