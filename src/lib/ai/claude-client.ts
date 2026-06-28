import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Thin wrapper around the Anthropic SDK with the defaults the Trust Stack
 * classifiers need:
 *
 *   - Server-only import guard so the API key cannot leak to a client bundle.
 *   - Strict timeout (the demo path needs a hard ceiling; we don't want the
 *     UI to hang if Anthropic is slow).
 *   - Structured tool-call output enforcement so the classifier cannot be
 *     prompt-injected into producing free-form text the caller doesn't expect.
 *   - Bounded max_tokens so a runaway model can't burn budget.
 *
 * Returns null when the env is not configured — callers decide whether to
 * fall back to Layer 1 or surface a "Layer 2 unavailable" message.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

export type ClaudeClient = Anthropic;

export function getClaudeClient(): ClaudeClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length < 16) return null;
  return new Anthropic({
    apiKey,
    timeout: DEFAULT_TIMEOUT_MS,
    maxRetries: 1,
  });
}

export function getClaudeModel(): string {
  return process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
}

/**
 * Wraps a system prompt as a single cached text block so Anthropic prompt
 * caching reuses it across turns (~10% input cost on a cache hit, 5-min TTL).
 * The agent's system prompt (persona + policies + KB) is stable per agent, so
 * it's the ideal cache prefix and it's re-sent on every turn today.
 *
 * Caching only engages above the model's minimum cacheable size (~1024 tokens
 * for Haiku/Sonnet); below that it's a harmless no-op.
 */
export function cachedSystem(text: string): Anthropic.Messages.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/**
 * Run a single-turn classification call with a tool-use schema. The model
 * MUST respond by calling the provided tool — that's our structured-output
 * guarantee. If it tries to free-text instead, we return null.
 *
 * Generic over the tool's input shape so callers get a typed result.
 */
export async function classifyWithTool<TInput>(opts: {
  systemPrompt: string;
  userPrompt: string;
  toolName: string;
  toolDescription: string;
  toolInputSchema: Record<string, unknown>;
}): Promise<TInput | null> {
  const client = getClaudeClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: getClaudeModel(),
      max_tokens: 1024,
      system: opts.systemPrompt,
      messages: [{ role: "user", content: opts.userPrompt }],
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: opts.toolInputSchema as Anthropic.Messages.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: opts.toolName },
    });

    const toolBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolBlock || toolBlock.name !== opts.toolName) return null;
    return toolBlock.input as TInput;
  } catch {
    // Anthropic error (timeout, rate limit, auth, etc.) — caller decides
    // fallback behavior. We never throw so Layer 1 keeps protecting requests
    // even when Layer 2 is down.
    return null;
  }
}
