/**
 * URL scheme for the Clients section, plus the mapping that sends the old
 * admin detail routes (engagement/[id], agent/[id], crm/[accountId]) to it.
 * Pure so the redirect table is unit tested.
 *
 *   /admin/clients/<accountId>        a CRM account (the normal case)
 *   /admin/clients/e/<engagementId>   a legacy engagement with no account,
 *                                     grouped with its same-name siblings
 */

export const CLIENT_TABS = ["overview", "conversations", "approvals", "setup"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

/** Collapsible Setup sections that a link can ask to open. */
export const SETUP_SECTIONS = ["costs", "audit"] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];

export type ClientScope =
  | { kind: "account"; accountId: string }
  | { kind: "engagement"; engagementId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function first(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseClientTab(raw: unknown): ClientTab {
  const v = first(raw);
  return (CLIENT_TABS as readonly string[]).includes(v as string) ? (v as ClientTab) : "overview";
}

export function parseSetupSection(raw: unknown): SetupSection | null {
  const v = first(raw);
  return (SETUP_SECTIONS as readonly string[]).includes(v as string) ? (v as SetupSection) : null;
}

export function clientBasePath(scope: ClientScope): string {
  return scope.kind === "account"
    ? `/admin/clients/${encodeURIComponent(scope.accountId)}`
    : `/admin/clients/e/${encodeURIComponent(scope.engagementId)}`;
}

/** Where an engagement's client lives: its account, or the legacy page. */
export function scopeForEngagement(e: { id: string; account_id: string | null }): ClientScope {
  return e.account_id
    ? { kind: "account", accountId: e.account_id }
    : { kind: "engagement", engagementId: e.id };
}

export type ClientLinkOptions = {
  tab?: ClientTab;
  open?: SetupSection | null;
  agentId?: string | null;
  anchor?: string | null;
};

export function clientHref(scope: ClientScope, opts: ClientLinkOptions = {}): string {
  const params = new URLSearchParams();
  if (opts.tab && opts.tab !== "overview") params.set("tab", opts.tab);
  if (opts.open) params.set("open", opts.open);
  if (opts.agentId) params.set("agent", opts.agentId);
  const qs = params.toString();
  return `${clientBasePath(scope)}${qs ? `?${qs}` : ""}${opts.anchor ? `#${opts.anchor}` : ""}`;
}

/**
 * Old engagement tabs -> new client tabs. Costs and the audit log are
 * operator detail, so they live in Setup (opened); incidents affect the
 * client relationship, so they sit on the Overview.
 */
export function legacyEngagementTab(raw: unknown): ClientLinkOptions & { tab: ClientTab } {
  switch (first(raw)) {
    case "hitl":
      return { tab: "approvals" };
    case "conversations":
      return { tab: "conversations" };
    case "costs":
      return { tab: "setup", open: "costs", anchor: "costs" };
    case "audit":
      return { tab: "setup", open: "audit", anchor: "audit" };
    case "incidents":
      return { tab: "overview", anchor: "incidents" };
    default:
      return { tab: "overview" };
  }
}

/** /admin/engagement/<id>?tab=x -> the client page of that engagement. */
export function engagementRedirectHref(
  e: { id: string; account_id: string | null },
  rawTab: unknown,
): string {
  return clientHref(scopeForEngagement(e), legacyEngagementTab(rawTab));
}

export function agentAnchor(agentId: string): string {
  return `agent-${agentId}`;
}

/** /admin/agent/<id> -> the Setup tab of its client, scrolled to that agent. */
export function agentRedirectHref(
  e: { id: string; account_id: string | null } | null,
  agentId: string,
): string {
  if (!e) return "/admin/clients";
  return clientHref(scopeForEngagement(e), {
    tab: "setup",
    agentId,
    anchor: agentAnchor(agentId),
  });
}
