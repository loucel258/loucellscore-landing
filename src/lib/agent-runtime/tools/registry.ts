import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { TurnContext } from "../context";

/**
 * Tool registry. A ToolDef is everything the runtime knows about one tool:
 * what the model sees, how its input is validated, its risk policy, and the
 * handler. Handlers get the turn context, which is already bound to the
 * workspace and the conversation (session / contact); the model never
 * supplies those ids.
 *
 * policy:
 *   read             looks something up, no side effects
 *   customer_confirm changes something for THIS customer. SMS: calling it
 *                    only stores the request; it runs when the customer
 *                    replies YES (pending-action.ts, steps/confirm.ts).
 *                    Web: the prompt tells the model to call it only after
 *                    the customer confirmed
 *   owner_hitl       drafts an action for the owner's approval queue
 *   escalate         hands the conversation to a person
 */

export type ToolPolicy = "read" | "customer_confirm" | "owner_hitl" | "escalate";

export type ToolCall = {
  id: string;
  name: string;
  /** The text the model wrote in the same response (fallback reply material). */
  text: string;
};

export type ToolOutput =
  /** Feed this back to the model as the tool_result and keep looping. */
  | { kind: "result"; content: string; isError?: boolean }
  /** End the turn now with a deterministic reply (no further model call). */
  | {
      kind: "end";
      outcome: "reply" | "escalated";
      reply: string;
      toolSummary?: string;
      /** Write the ALLOW assistant_reply audit row (handlers that audit their own action skip it). */
      auditReply: boolean;
      escalationReason?: string;
    }
  /** Fail the turn (web answers 502). */
  | { kind: "fail"; reason: string };

export type ToolDef<I> = {
  tool: Anthropic.Tool;
  schema: z.ZodType<I>;
  policy: ToolPolicy;
  /** Input failed the schema. Default: an is_error tool_result so the model can fix it. */
  onInvalid?: (ctx: TurnContext, call: ToolCall) => ToolOutput;
  handler: (input: I, ctx: TurnContext, call: ToolCall) => Promise<ToolOutput>;
};

/** A ToolDef with its input type erased, ready for the loop. */
export type RegisteredTool = {
  tool: Anthropic.Tool;
  policy: ToolPolicy;
  run(rawInput: unknown, ctx: TurnContext, call: ToolCall): Promise<ToolOutput>;
};

export function defineTool<I>(def: ToolDef<I>): RegisteredTool {
  return {
    tool: def.tool,
    policy: def.policy,
    async run(rawInput, ctx, call) {
      const parsed = def.schema.safeParse(rawInput);
      if (!parsed.success) {
        return (
          def.onInvalid?.(ctx, call) ?? {
            kind: "result",
            content: `Invalid input for ${call.name}. Check the required fields and try again.`,
            isError: true,
          }
        );
      }
      return def.handler(parsed.data, ctx, call);
    },
  };
}

/** One line per policy for the prompt's action contract (SMS). */
export function policyRules(tools: readonly RegisteredTool[], medium: "sms" | "voice" = "sms"): string[] {
  const names = (p: ToolPolicy) => tools.filter((t) => t.policy === p).map((t) => t.tool.name).join(", ");
  const lines: string[] = [];
  const read = names("read");
  const confirm = names("customer_confirm");
  const hitl = names("owner_hitl");
  const esc = names("escalate");
  if (read) lines.push(`- ${read}: look things up only.`);
  if (confirm && medium === "voice") {
    lines.push(
      `- ${confirm}: change something real for this caller, but calling one does NOT make the change. It saves the request and returns a short summary; the change happens only when the caller says yes (sí) on the next turn. Call it as soon as the caller has chosen the exact service and time (do not ask them to confirm first), then say the action out loud in spoken words and ask for a yes. Never say it is booked, changed, or cancelled until the system confirms it.`,
    );
  } else if (confirm) {
    lines.push(
      `- ${confirm}: change something real for this customer, but calling one does NOT make the change. It saves the request and returns a short summary; the change happens only when the customer replies YES. Call it as soon as the customer has chosen the exact service and time (do not ask them to confirm first), then ask them to reply YES (or SÍ) to confirm, quoting the summary in their language. Never say it is booked, changed, or cancelled until the system confirms it.`,
    );
  }
  if (hitl) lines.push(`- ${hitl}: sends a draft to the business owner for approval. Say it is pending review, never that it is done.`);
  if (esc) {
    lines.push(
      `- ${esc}: hands the conversation to a person. Use it for complaints, refunds, disputes, or whenever you are unsure. Do not guess.`,
    );
  }
  return lines;
}
