import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runLoop, type LoopPolicy } from "@/lib/agent-runtime/steps/loop";
import { createTurnContext } from "@/lib/agent-runtime/context";
import { toAgentConfig } from "@/lib/agent-runtime/config";
import { defineTool, type RegisteredTool } from "@/lib/agent-runtime/tools/registry";
import { runTurn } from "@/lib/agent-runtime/runtime";
import { agentFixture, fakeDeps, fakeModel, memoryStore, sentMessages, textMsg, toolMsg } from "./helpers";

/**
 * runLoop: every tool_use gets a tool_result before the next call; the
 * iteration cap and the deadline end the loop (the caller escalates).
 */

function ctxFor(now = () => Date.now()) {
  const store = memoryStore();
  const { deps } = fakeDeps(store, null);
  deps.now = now;
  const ctx = createTurnContext(
    {
      channel: "sms",
      agent: toAgentConfig(agentFixture())!,
      conv: { kind: "contact", contactId: "c1", phone: "+15615550123" },
      text: "hola",
      locale: "es",
      receivedAt: new Date(now()),
    },
    deps,
  );
  return { ctx, deps, store };
}

const lookup = vi.fn(async () => ({ kind: "result" as const, content: "found" }));
const LOOKUP: RegisteredTool = defineTool({
  tool: { name: "lookup", description: "x", input_schema: { type: "object", properties: {} } },
  schema: z.object({}),
  policy: "read",
  handler: lookup,
});
const FINISH: RegisteredTool = defineTool({
  tool: { name: "finish", description: "x", input_schema: { type: "object", properties: {} } },
  schema: z.object({}),
  policy: "escalate",
  handler: async () => ({ kind: "end", outcome: "escalated", reply: "A person will follow up.", auditReply: true }),
});

const policy = (over: Partial<LoopPolicy> = {}): LoopPolicy => ({
  model: "m",
  maxTokens: 100,
  maxIterations: 4,
  maxActions: 8,
  callTimeoutMs: 1000,
  deadlineAt: Date.now() + 60_000,
  ...over,
});

const user: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "hola" }];

describe("runLoop", () => {
  it("answers EVERY tool_use (known, unknown and over-budget) before the next call", async () => {
    lookup.mockClear();
    const model = fakeModel(
      toolMsg([
        { id: "a", name: "lookup", input: {} },
        { id: "b", name: "not_a_tool", input: {} },
        { id: "c", name: "lookup", input: {} },
      ]),
      textMsg("done"),
    );
    const { ctx } = ctxFor();
    const r = await runLoop({ client: model.client, system: [], messages: user, tools: [LOOKUP], policy: policy({ maxActions: 1 }), ctx });
    expect(r).toEqual({ kind: "text", text: "done" });
    expect(lookup).toHaveBeenCalledTimes(1);
    const results = sentMessages(model.create, 1).at(-1)!.content as Anthropic.Messages.ToolResultBlockParam[];
    expect(results.map((b) => b.tool_use_id)).toEqual(["a", "b", "c"]);
    expect(results.map((b) => b.is_error ?? false)).toEqual([false, true, true]);
    expect(results[2]!.content).toMatch(/only one action/);
  });

  it("iteration cap while the model still wants tools → cap (no tools run on the last call)", async () => {
    lookup.mockClear();
    const model = fakeModel(toolMsg([{ id: "t", name: "lookup", input: {} }], "Let me check..."));
    const { ctx } = ctxFor();
    const r = await runLoop({ client: model.client, system: [], messages: user, tools: [LOOKUP], policy: policy({ maxIterations: 3 }), ctx });
    expect(r).toEqual({ kind: "cap", text: "Let me check..." });
    expect(model.create).toHaveBeenCalledTimes(3);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("deadline: no model call starts after it", async () => {
    let t = 1_000;
    const model = fakeModel(toolMsg([{ id: "t", name: "lookup", input: {} }]));
    model.create.mockImplementation(async () => {
      t += 30_000; // each call takes 30s
      return toolMsg([{ id: `t${t}`, name: "lookup", input: {} }]);
    });
    const { ctx } = ctxFor(() => t);
    const r = await runLoop({ client: model.client, system: [], messages: user, tools: [LOOKUP], policy: policy({ deadlineAt: 50_000 }), ctx });
    expect(r).toEqual({ kind: "deadline" });
    expect(model.create).toHaveBeenCalledTimes(2);
  });

  it("a terminal tool ends the turn without another model call", async () => {
    const model = fakeModel(toolMsg([{ id: "t", name: "finish", input: {} }]));
    const { ctx } = ctxFor();
    const r = await runLoop({ client: model.client, system: [], messages: user, tools: [FINISH], policy: policy(), ctx });
    expect(r.kind).toBe("end");
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it("model error is reported, not thrown", async () => {
    const model = fakeModel(Object.assign(new Error("x"), { name: "APIConnectionTimeoutError" }));
    const { ctx } = ctxFor();
    const r = await runLoop({ client: model.client, system: [], messages: user, tools: [], policy: policy(), ctx });
    expect(r).toEqual({ kind: "model_error", errorName: "APIConnectionTimeoutError" });
  });
});

describe("runTurn escalates on cap / deadline", () => {
  const smsInbound = (receivedAt: Date) => ({
    channel: "sms" as const,
    agent: toAgentConfig(agentFixture())!,
    conv: { kind: "contact" as const, contactId: "c1", phone: "+15615550123" },
    text: "quiero una cita",
    dedupeKey: "SMx",
    locale: "es" as const,
    receivedAt,
  });

  it("SMS deadline → escalated outcome, follow-up promised only because the alert went out", async () => {
    const store = memoryStore();
    const model = fakeModel(textMsg("never"));
    const { deps } = fakeDeps(store, model.client);
    const out = await runTurn(smsInbound(new Date(Date.now() - 120_000)), deps);
    expect(model.create).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "escalated", reason: "deadline", notified: true });
    expect((out as { text: string }).text).toMatch(/te responderá/);
  });

  it("SMS cap with alerts down → no promise of a follow-up", async () => {
    const store = memoryStore();
    const model = fakeModel(toolMsg([{ id: "t", name: "get_my_appointments", input: {} }], "Un momento..."));
    const { deps } = fakeDeps(store, model.client);
    deps.sendAlert = vi.fn(async () => ({ ok: false as const, reason: "alerts_disabled" as never }));
    const out = await runTurn(smsInbound(new Date()), deps);
    expect(out).toMatchObject({ kind: "escalated", reason: "tool_loop_cap", notified: false });
    expect((out as { text: string }).text).toMatch(/comunícate directamente con Test Salon/);
  });
});
