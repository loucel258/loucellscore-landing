import "server-only";
import type { Metered } from "@/lib/ai/claude-client";
import { _collectAndApply, type Redaction, type SanitizeResult } from "./sanitizer";
import { classifyWithLLM } from "./classifier-llm";
import { Layer2RequiredError } from "@/lib/clients/policy";

/**
 * Server-only async sanitizer that adds Layer 2 (Claude Haiku) on top of
 * the deterministic Layer 1 + 1.5 detectors.
 *
 * Lives in a separate file so client bundles importing `sanitize` for
 * preview rendering never reach the Anthropic SDK.
 *
 * When `opts.failClosed` is true (regulated tenant policy) and the LLM
 * is unavailable, throws Layer2RequiredError instead of silently
 * degrading to Layer 1.
 */
export async function sanitizeWithLLM(
  rawPrompt: string,
  opts: { failClosed?: boolean; workspace_id?: string } = {},
): Promise<SanitizeResult> {
  return (await sanitizeWithLLMMetered(rawPrompt, opts)).result;
}

/**
 * sanitizeWithLLM plus the Layer 2 call's token usage, for callers that bill
 * a tenant's monthly budget (the agent runtime's DLP screen). The result
 * itself is identical to sanitizeWithLLM's.
 */
export async function sanitizeWithLLMMetered(
  rawPrompt: string,
  opts: { failClosed?: boolean; workspace_id?: string } = {},
): Promise<Metered<SanitizeResult>> {
  const llmResult = await classifyWithLLM(rawPrompt);
  const usage = llmResult.usage ?? null;

  if (!llmResult.available && opts.failClosed) {
    throw new Layer2RequiredError(
      opts.workspace_id ?? "unknown",
      "classifier returned no result",
    );
  }

  const llmRedactions: Redaction[] = [];
  for (const finding of llmResult.findings) {
    let searchFrom = 0;
    while (true) {
      const idx = rawPrompt.indexOf(finding.match, searchFrom);
      if (idx === -1) break;
      llmRedactions.push({
        type: finding.type,
        label: `LLM ${finding.type}: ${finding.reason}`,
        match: finding.match,
        replacement: `[REDACTED_${finding.type}]`,
        start: idx,
        end: idx + finding.match.length,
        source: "llm",
        confidence: finding.confidence,
      });
      searchFrom = idx + finding.match.length;
    }
  }

  const result = _collectAndApply(rawPrompt, llmRedactions);
  return {
    result: {
      ...result,
      layer2Used: true,
      layer2Available: llmResult.available,
    },
    usage,
  };
}
