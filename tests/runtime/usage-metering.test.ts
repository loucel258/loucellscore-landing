import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toAgentConfig } from "@/lib/agent-runtime/config";
import { runTurn } from "@/lib/agent-runtime/runtime";
import { sanitize } from "@/lib/dlp/sanitizer";
import { agentFixture, fakeDeps, fakeModel, memoryStore, textMsg } from "./helpers";

/**
 * Budget accuracy: every model call a turn makes is billed to the agent's
 * workspace, not only the agent loop. The SMS triage classifier and DLP
 * Layer 2 (both Haiku) used to be free as far as the budget could tell.
 */

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...a: unknown[]) => create(...a) };
  },
}));

const { classifyWithTool, classifyWithToolMetered } = await import("@/lib/ai/claude-client");
const { classifyWithLLM } = await import("@/lib/dlp/classifier-llm");
const { sanitizeWithLLM, sanitizeWithLLMMetered } = await import("@/lib/dlp/sanitizer-llm");
const { classifyIntent, classifyIntentMetered } = await import("@/lib/booking/intent");

const USAGE = { input_tokens: 300, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 };
const toolResponse = (name: string, input: unknown) => ({
  content: [{ type: "tool_use", id: "tu_1", name, input }],
  usage: USAGE,
});

const savedKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = "sk-test-0000000000000000";
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

describe("classifier calls report their usage", () => {
  const opts = {
    systemPrompt: "s",
    userPrompt: "u",
    toolName: "label",
    toolDescription: "d",
    toolInputSchema: { type: "object", properties: {} },
  };

  it("classifyWithToolMetered → { result, usage }; classifyWithTool keeps returning the bare result", async () => {
    create.mockResolvedValue(toolResponse("label", { x: 1 }));
    expect(await classifyWithToolMetered(opts)).toEqual({ result: { x: 1 }, usage: USAGE });
    expect(await classifyWithTool(opts)).toEqual({ x: 1 });
  });

  it("usage is still reported when the model skipped the tool (the call was billed)", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: "no" }], usage: USAGE });
    expect(await classifyWithToolMetered(opts)).toEqual({ result: null, usage: USAGE });
  });

  it("no client or an API error → no usage", async () => {
    create.mockRejectedValue(new Error("timeout"));
    expect(await classifyWithToolMetered(opts)).toEqual({ result: null, usage: null });
    delete process.env.ANTHROPIC_API_KEY;
    expect(await classifyWithToolMetered(opts)).toEqual({ result: null, usage: null });
  });

  it("DLP Layer 2 carries usage; sanitizeWithLLM's result shape is unchanged (demo routes)", async () => {
    const text = "my passport number is X1234567 thanks";
    create.mockResolvedValue(
      toolResponse("report_pii_findings", {
        findings: [{ type: "PASSPORT", match: "X1234567", reason: "passport", confidence: 90 }],
      }),
    );
    expect((await classifyWithLLM(text)).usage).toEqual(USAGE);
    const metered = await sanitizeWithLLMMetered(text);
    expect(metered.usage).toEqual(USAGE);
    expect(metered.result.layer2Available).toBe(true);
    expect(metered.result.sanitized).toContain("[REDACTED_PASSPORT]");
    const plain = await sanitizeWithLLM(text);
    expect(plain).toEqual(metered.result);
    expect(plain).not.toHaveProperty("usage");
  });

  it("SMS intent classifier carries usage; classifyIntent keeps its old return", async () => {
    create.mockResolvedValue(toolResponse("classify_intent", { intent: "book", confidence: "high" }));
    expect(await classifyIntentMetered("quiero una cita")).toEqual({
      result: { intent: "book", confidence: "high" },
      usage: USAGE,
    });
    expect(await classifyIntent("quiero una cita")).toEqual({ intent: "book", confidence: "high" });
  });
});

describe("the runtime bills triage + DLP Layer 2 to the agent's workspace", () => {
  // usageTokens: 300 + 1000 * 0.1 (cache read) = 400 in, 40 out.
  const BILLED = ["ws_test", 400, 40, 2_000_000];

  it("SMS: the triage classifier's tokens are recorded, alongside the agent loop's", async () => {
    const store = memoryStore();
    const model = fakeModel(textMsg("¡Claro!"));
    const { deps } = fakeDeps(store, model.client);
    deps.classifyIntent = vi.fn(async () => ({ result: { intent: "book" as const, confidence: "high" as const }, usage: USAGE }));
    await runTurn(
      {
        channel: "sms",
        agent: toAgentConfig(agentFixture())!,
        conv: { kind: "contact", contactId: "c1", phone: "+15615550123" },
        text: "hola",
        dedupeKey: "SM1",
        locale: "es",
        receivedAt: new Date(),
      },
      deps,
    );
    const calls = vi.mocked(deps.recordUsage).mock.calls;
    expect(calls).toContainEqual(BILLED);
    // Agent loop call (helpers USAGE: 10 in, 5 out) still billed too.
    expect(calls).toContainEqual(["ws_test", 10, 5, 2_000_000]);
  });

  it("SMS: a triage escalation (no agent loop) still bills the classifier", async () => {
    const store = memoryStore();
    const { deps } = fakeDeps(store, fakeModel(textMsg("x")).client);
    deps.classifyIntent = vi.fn(async () => ({ result: { intent: "other" as const, confidence: "low" as const }, usage: USAGE }));
    await runTurn(
      {
        channel: "sms",
        agent: toAgentConfig(agentFixture())!,
        conv: { kind: "contact", contactId: "c1", phone: "+15615550123" },
        text: "something odd",
        dedupeKey: "SM2",
        locale: "es",
        receivedAt: new Date(),
      },
      deps,
    );
    expect(vi.mocked(deps.recordUsage).mock.calls).toEqual([BILLED]);
  });

  const webInbound = (text: string) => ({
    channel: "web" as const,
    agent: toAgentConfig(agentFixture())!,
    conv: { kind: "session" as const, sessionId: "s_abc12345" },
    text,
    locale: "en" as const,
    receivedAt: new Date(),
  });

  it("web: DLP Layer 2 tokens are recorded (long messages only; short ones skip Layer 2)", async () => {
    const store = memoryStore();
    const { deps } = fakeDeps(store, fakeModel(textMsg("Sure.")).client);
    deps.sanitizeWithLLM = vi.fn(async (t: string) => ({
      result: { ...sanitize(t), layer2Used: true, layer2Available: true },
      usage: USAGE,
    }));
    await runTurn(webInbound("what are your opening hours on saturday?"), deps);
    expect(vi.mocked(deps.recordUsage).mock.calls).toContainEqual(BILLED);

    vi.mocked(deps.recordUsage).mockClear();
    await runTurn(webInbound("hi"), deps);
    expect(vi.mocked(deps.recordUsage).mock.calls).not.toContainEqual(BILLED);
  });

  it("web: a Layer 2 block (model never called) still bills the classifier", async () => {
    const store = memoryStore();
    const model = fakeModel(textMsg("never"));
    const { deps } = fakeDeps(store, model.client);
    deps.sanitizeWithLLM = vi.fn(async (t: string) => {
      const base = sanitize(t);
      return {
        result: {
          ...base,
          redactions: [
            { type: "SSN", label: "LLM SSN", match: "x", replacement: "[REDACTED_SSN]", start: 0, end: 1, source: "llm" as const, confidence: 90 },
          ],
          layer2Used: true,
          layer2Available: true,
        },
        usage: USAGE,
      };
    });
    const out = await runTurn(webInbound("my social is one two three four five six seven"), deps);
    expect(out).toMatchObject({ kind: "blocked", reason: "pii" });
    expect(model.create).not.toHaveBeenCalled();
    expect(vi.mocked(deps.recordUsage).mock.calls).toEqual([BILLED]);
  });

  it("a failing usage write never breaks the turn", async () => {
    const store = memoryStore();
    const { deps } = fakeDeps(store, fakeModel(textMsg("Sure.")).client);
    deps.recordUsage = vi.fn(async () => {
      throw new Error("db down");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await runTurn(webInbound("hello there"), deps);
    expect(out).toMatchObject({ kind: "reply", text: "Sure." });
  });
});
