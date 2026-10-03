import { vi } from "vitest";
import crypto from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { ResolvedAgent } from "@/lib/agents/resolver";
import type { AuditEntry } from "@/lib/audit/types";
import type { Contact } from "@/lib/booking/contacts";
import { sanitize } from "@/lib/dlp/sanitizer";
import type { TurnDeps } from "@/lib/agent-runtime/deps";
import type {
  EscalationRow,
  RuntimeStore,
  ServiceLite,
  SmsHistoryRow,
  SmsLogRow,
  StoreError,
  TranscriptRow,
} from "@/lib/agent-runtime/store";

/**
 * In-memory fakes for the agent runtime: no network, no DB, no Claude.
 * (Not a test file: vitest only collects *.test.ts.)
 */

export function agentFixture(over: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "test-agent",
    workspaceId: "ws_test",
    engagementId: "00000000-0000-0000-0000-0000000000e1",
    name: "Test Salon",
    agentType: "ai_front_desk",
    status: "live",
    systemPrompt: "Friendly salon front desk.",
    allowedOrigins: ["https://client.example"],
    toolsEnabled: [],
    // Discloses the AI, so web replies in unrelated tests stay verbatim (disclosure.test.ts covers the rest).
    greetingMessage: "Hi, I'm the virtual assistant.",
    brandColor: null,
    maxTokens: 1024,
    language: "es",
    retentionDays: 90,
    minutesPerConv: 5,
    monthlyTokenBudget: 2_000_000,
    integrations: {},
    vertical: "nail salon",
    ...over,
  };
}

type Usage = Partial<Anthropic.Messages.Usage>;
const USAGE: Usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function message(content: unknown[], stop: string, usage: Usage = USAGE): Anthropic.Messages.Message {
  return {
    id: `msg_${crypto.randomUUID()}`,
    type: "message",
    role: "assistant",
    model: "test-model",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage,
  } as unknown as Anthropic.Messages.Message;
}

export const textMsg = (text: string, usage?: Usage) => message([{ type: "text", text }], "end_turn", usage);

export const toolMsg = (
  calls: { id: string; name: string; input: unknown }[],
  text = "",
  usage?: Usage,
) =>
  message(
    [...(text ? [{ type: "text", text }] : []), ...calls.map((c) => ({ type: "tool_use", ...c }))],
    "tool_use",
    usage,
  );

/** A model client whose responses are scripted per call. */
export function fakeModel(...responses: (Anthropic.Messages.Message | Error)[]) {
  const create = vi.fn(async () => {
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { messages: { create } }, create };
}

/** Messages sent on the Nth model call. */
export function sentMessages(create: ReturnType<typeof vi.fn>, call: number): Anthropic.Messages.MessageParam[] {
  const args = create.mock.calls[call] as unknown as [Anthropic.Messages.MessageCreateParamsNonStreaming];
  return args[0].messages;
}

export type MemoryStore = RuntimeStore & {
  calls: string[];
  escalations: EscalationRow[];
  messages: (SmsLogRow & { id: string })[];
  transcripts: Map<string, TranscriptRow[] | null>;
  paused: Set<string>;
  contacts: Map<string, Contact>;
  escalationError: StoreError | null;
  pending: { pending: number; duplicate: boolean };
  services: ServiceLite[];
  optedOut: string[];
  /** contacts.metadata by contact id. */
  metadata: Map<string, Record<string, unknown>>;
  /**
   * true (default): every contact counts as already written to, so SMS replies
   * stay verbatim. false: only real outbound rows count (disclosure tests).
   */
  introduced: boolean;
};

export function memoryStore(): MemoryStore {
  const store: MemoryStore = {
    calls: [],
    escalations: [],
    messages: [],
    transcripts: new Map(),
    paused: new Set(),
    contacts: new Map(),
    escalationError: null,
    pending: { pending: 0, duplicate: false },
    services: [{ id: "svc_gel", name: "Gel", duration_min: 60, price_cents: 4500 }],
    optedOut: [],
    metadata: new Map(),
    introduced: true,
    async isPaused(_eng, key) {
      return store.paused.has(key);
    },
    async recentTranscript(ws, sid) {
      const key = `${ws}:${sid}`;
      return store.transcripts.has(key) ? store.transcripts.get(key)! : [];
    },
    async pendingApprovals() {
      return store.pending;
    },
    async insertEscalation(row) {
      store.calls.push("insertEscalation");
      if (store.escalationError) return store.escalationError;
      store.escalations.push(row);
      return null;
    },
    async claimInbound({ workspaceId, contactId, body, providerSid }) {
      if (
        providerSid &&
        store.messages.some((m) => m.workspaceId === workspaceId && m.direction === "inbound" && m.providerSid === providerSid)
      ) {
        return { status: "duplicate" };
      }
      const id = crypto.randomUUID();
      store.messages.push({ id, workspaceId, contactId, direction: "inbound", body, providerSid });
      return { status: "claimed", id };
    },
    async logMessage(row) {
      store.messages.push({ id: crypto.randomUUID(), ...row });
    },
    async smsHistory({ contactId, excludeId, limit }) {
      const rows: SmsHistoryRow[] = store.messages
        .filter((m) => m.contactId === contactId && m.id !== excludeId)
        .reverse()
        .slice(0, limit)
        .map((m) => ({ id: m.id, direction: m.direction, body: m.body, status: m.status ?? null }));
      // An empty-bodied outbound row: counts as "already written to", never reaches the model.
      if (store.introduced) rows.push({ id: "introduced", direction: "outbound", body: null, status: "sent" });
      return rows;
    },
    async listServices() {
      return store.services;
    },
    async sentRecently(_ws, contactId, body) {
      return store.messages.some((m) => m.contactId === contactId && m.direction === "outbound" && m.body === body);
    },
    async getOrCreateContact(ws, phone) {
      const existing = store.contacts.get(phone);
      if (existing) return existing;
      const c: Contact = {
        id: crypto.randomUUID(),
        workspace_id: ws,
        phone,
        name: null,
        timezone: "America/New_York",
        consent_transactional: false,
        consent_marketing: false,
        opted_out: false,
      };
      store.contacts.set(phone, c);
      return c;
    },
    async optOut(_ws, phone) {
      store.optedOut.push(phone);
      const c = store.contacts.get(phone);
      if (c) c.opted_out = true;
    },
    async optIn(_ws, contactId) {
      for (const c of store.contacts.values()) if (c.id === contactId) c.opted_out = false;
    },
    async getPendingAction(_ws, contactId) {
      return store.metadata.get(contactId)?.pending_action ?? null;
    },
    async setPendingAction(_ws, contactId, action) {
      store.calls.push("setPendingAction");
      store.metadata.set(contactId, { ...(store.metadata.get(contactId) ?? {}), pending_action: action });
      return true;
    },
    async takePendingAction(_ws, contactId, actionId) {
      // Same compare-and-swap contract as the Supabase store.
      const meta = store.metadata.get(contactId);
      const current = meta?.pending_action as { id?: string } | undefined;
      if (!meta || current?.id !== actionId) return false;
      const rest = { ...meta };
      delete rest.pending_action;
      store.metadata.set(contactId, rest);
      store.calls.push("takePendingAction");
      return true;
    },
  };
  return store;
}

/** Fake transcript cipher: "enc:<text>" (the real one is AES-GCM, see portal/encrypt). */
export const enc = (text: string) => `enc:${text}`;

export function fakeDeps(store: MemoryStore, client: { messages: { create: ReturnType<typeof vi.fn> } } | null) {
  const audits: AuditEntry[] = [];
  const order: string[] = store.calls;
  const deps: TurnDeps = {
    now: () => Date.now(),
    claude: () => client as never,
    sb: {} as never,
    store,
    rateLimit: vi.fn(async () => ({ allowed: true, remaining: 5, retryAfterSec: 0 })),
    isBudgetExhausted: vi.fn(async () => false),
    recordUsage: vi.fn(async () => {}),
    sanitize,
    sanitizeWithLLM: vi.fn(async (t: string) => ({
      result: { ...sanitize(t), layer2Used: true, layer2Available: false },
      usage: null,
    })),
    writeAudit: vi.fn(async (e: AuditEntry) => {
      audits.push(e);
      return { ok: true };
    }),
    persistTurn: vi.fn(async () => {}),
    sendAlert: vi.fn(async () => {
      order.push("sendAlert");
      return { ok: true as const, id: "mail_1" };
    }),
    insertLead: vi.fn(async () => ({ ok: true as const, leadId: "lead_1" })),
    propose: vi.fn(async () => ({ ok: true as const, data: { id: "appr_1" } as never })),
    classifyIntent: vi.fn(async () => ({
      result: { intent: "book" as const, confidence: "high" as const },
      usage: null,
    })),
    resolveBookingBackend: vi.fn(async () => ({ mode: "local" as const })),
    dispatchBookingTool: vi.fn(async () => ({ content: JSON.stringify({ slots: [] }) })),
    decrypt: (_eng: string, cipher: string) => {
      if (!cipher.startsWith("enc:")) throw new Error("bad cipher");
      return cipher.slice(4);
    },
    encryptionAvailable: () => true,
    // Never a real email from tests.
    sendOwnerEmail: vi.fn(async () => ({ ok: true as const, id: "owner_mail_1" })),
    ownerPortal: vi.fn(async () => ({ baseUrl: "https://app.example/portal/test-agent", lang: "es" as const })),
  };
  return { deps, audits };
}

export const auditReasons = (audits: AuditEntry[]) => audits.map((a) => `${a.decision}:${a.reason}`);
