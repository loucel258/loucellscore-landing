import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "../deps";
import type { TurnContext } from "../context";
import type { RegisteredTool, ToolOutput } from "../tools/registry";

/**
 * runLoop: the model ↔ tools loop, the same for every channel.
 *
 *   - Every tool_use the model emits is answered with a tool_result before
 *     the next call (unknown / over-budget tools get an is_error result), so
 *     the API never rejects the follow-up.
 *   - A tool may END the turn (deterministic reply, no further call) or FAIL it.
 *   - Once the action budget is spent, the next response's text is final
 *     (web: one action, then one follow-up for the booking link).
 *   - Iteration cap with the model still asking for tools → "cap"; out of
 *     time → "deadline". The caller escalates on both: a preamble like
 *     "let me check..." is never sent as an answer.
 */

export type LoopPolicy = {
  model: string;
  maxTokens: number;
  temperature?: number;
  maxIterations: number;
  maxActions: number;
  callTimeoutMs: number;
  /** Epoch ms. No model call starts after it; in-flight calls are aborted at it. */
  deadlineAt: number;
};

export type LoopResult =
  /** `streamed`: voice already spoke this text (nothing left to say). */
  | { kind: "text"; text: string; streamed?: boolean }
  | { kind: "aborted" }
  | { kind: "end"; end: Extract<ToolOutput, { kind: "end" }> }
  | { kind: "fail"; reason: string }
  | { kind: "cap"; text: string }
  | { kind: "deadline" }
  | { kind: "model_error"; errorName: string };

export type LoopArgs = {
  client: ModelClient;
  system: Anthropic.Messages.TextBlockParam[];
  messages: Anthropic.Messages.MessageParam[];
  tools: readonly RegisteredTool[];
  policy: LoopPolicy;
  ctx: TurnContext;
  /** Voice: speak text as it streams, say one filler before tools. */
  voice?: { speak(text: string): void; filler(): void; aborted(): boolean; signal?: AbortSignal };
  /** Called after every model response (budget accounting). */
  onUsage?: (usage: Anthropic.Messages.Usage) => Promise<void> | void;
};

const textOf = (content: Anthropic.Messages.ContentBlock[]) =>
  content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "APIUserAbortError" || e.name === "TimeoutError");
}

export async function runLoop(args: LoopArgs): Promise<LoopResult> {
  const { client, system, tools, policy, ctx } = args;
  const messages = [...args.messages];
  const byName = new Map(tools.map((t) => [t.tool.name, t]));
  const toolSpecs = tools.map((t) => t.tool);
  let actions = 0;
  const voice = args.voice;
  let fillerDone = false;

  for (let i = 0; i < policy.maxIterations; i++) {
    if (voice?.aborted()) return { kind: "aborted" };
    const remaining = policy.deadlineAt - ctx.deps.now();
    if (remaining <= 0) return { kind: "deadline" };

    let resp: Anthropic.Messages.Message;
    let streamedNow = false;
    try {
      const body = {
        model: policy.model,
        max_tokens: policy.maxTokens,
        ...(policy.temperature !== undefined ? { temperature: policy.temperature } : {}),
        system,
        tools: toolSpecs.length > 0 ? toolSpecs : undefined,
        messages: [...messages],
      };
      // The caller speaking over the agent cancels the model call too (no tokens spent on an unheard answer).
      const deadline = AbortSignal.timeout(remaining);
      const signal = voice?.signal ? AbortSignal.any([deadline, voice.signal]) : deadline;
      const opts = { timeout: Math.min(policy.callTimeoutMs, remaining), signal };
      if (voice && client.messages.stream) {
        const stream = client.messages.stream(body, opts);
        stream.on("text", (delta) => {
          if (voice.aborted() || !delta) return;
          streamedNow = true;
          voice.speak(delta);
        });
        resp = await stream.finalMessage();
      } else {
        resp = await client.messages.create(body, opts);
        const said = voice ? textOf(resp.content) : "";
        if (voice && said && !voice.aborted()) {
          streamedNow = true;
          voice.speak(said);
        }
      }
    } catch (e) {
      if (voice?.aborted()) return { kind: "aborted" };
      if (isAbort(e) && ctx.deps.now() >= policy.deadlineAt) return { kind: "deadline" };
      return { kind: "model_error", errorName: e instanceof Error ? e.name || "error" : "non_error" };
    }
    ctx.usage.rawIn += resp.usage?.input_tokens ?? 0;
    ctx.usage.rawOut += resp.usage?.output_tokens ?? 0;
    await args.onUsage?.(resp.usage);

    const text = textOf(resp.content);
    const toolUses = resp.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) return { kind: "text", text, ...(streamedNow ? { streamed: true } : {}) };
    if (actions >= policy.maxActions) return { kind: "text", text, ...(streamedNow ? { streamed: true } : {}) };
    if (i === policy.maxIterations - 1) return { kind: "cap", text };
    if (voice) {
      // Dead air while a tool runs is the worst thing on a phone: the
      // model's own lead-in counts, otherwise one short filler.
      if (!streamedNow && !fillerDone) voice.filler();
      fillerDone = true;
    }

    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const tool = byName.get(tu.name);
      if (!tool) {
        // Whitelist guard: a hallucinated / disabled tool name never runs.
        results.push({ type: "tool_result", tool_use_id: tu.id, content: "Unknown tool. Nothing was executed.", is_error: true });
        continue;
      }
      if (actions >= policy.maxActions) {
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: "Not executed: only one action can run per turn.",
          is_error: true,
        });
        continue;
      }
      if (voice?.aborted()) return { kind: "aborted" };
      actions++;
      let out: ToolOutput;
      try {
        out = await tool.run(tu.input, ctx, { id: tu.id, name: tu.name, text });
      } catch (e) {
        console.error("[agent-runtime] tool failed", tu.name, e instanceof Error ? e.name : "error");
        out = { kind: "result", content: JSON.stringify({ ok: false, error: "unavailable" }), isError: true };
      }
      ctx.toolsUsed.push(tu.name);
      if (out.kind === "end") return { kind: "end", end: out };
      if (out.kind === "fail") return { kind: "fail", reason: out.reason };
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: out.content,
        ...(out.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "assistant", content: resp.content }, { role: "user", content: results });
  }
  return { kind: "cap", text: "" };
}
