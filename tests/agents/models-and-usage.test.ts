import { describe, it, expect, afterEach, vi } from "vitest";
import { modelFor, DEFAULT_MODELS } from "@/lib/ai/models";

vi.mock("@/lib/notify/resend", () => ({ sendInternalAlert: vi.fn() }));
vi.mock("@/lib/admin/settings", () => ({ getAdminSettings: vi.fn() }));
vi.mock("@/lib/audit/client", () => ({ getServiceClient: () => null }));

const { usageTokens } = await import("@/lib/agents/budget");

/**
 * Model IDs are centralized but must keep the exact production values and
 * env overrides the call sites used before.
 */
describe("modelFor", () => {
  const saved = { m: process.env.ANTHROPIC_MODEL, d: process.env.ANTHROPIC_DRAFT_MODEL };
  afterEach(() => {
    if (saved.m === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = saved.m;
    if (saved.d === undefined) delete process.env.ANTHROPIC_DRAFT_MODEL;
    else process.env.ANTHROPIC_DRAFT_MODEL = saved.d;
  });

  it("defaults match what production runs today", () => {
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_DRAFT_MODEL;
    expect(modelFor("chat")).toBe("claude-haiku-4-5-20251001");
    expect(modelFor("classifier")).toBe("claude-haiku-4-5-20251001");
    expect(modelFor("sms_agent")).toBe("claude-sonnet-4-6");
    expect(DEFAULT_MODELS).toEqual({
      chat: "claude-haiku-4-5-20251001",
      classifier: "claude-haiku-4-5-20251001",
      sms_agent: "claude-sonnet-4-6",
    });
  });

  it("honors ANTHROPIC_MODEL (chat + classifier) and ANTHROPIC_DRAFT_MODEL (sms)", () => {
    process.env.ANTHROPIC_MODEL = "m-chat";
    process.env.ANTHROPIC_DRAFT_MODEL = "m-draft";
    expect(modelFor("chat")).toBe("m-chat");
    expect(modelFor("classifier")).toBe("m-chat");
    expect(modelFor("sms_agent")).toBe("m-draft");
  });
});

describe("usageTokens (budget accounting)", () => {
  it("counts cache tokens weighted by price (writes 1.25x, reads 0.1x)", () => {
    expect(
      usageTokens({
        input_tokens: 40,
        output_tokens: 120,
        cache_creation_input_tokens: 3000,
        cache_read_input_tokens: 0,
      }),
    ).toEqual({ tokensIn: 3790, tokensOut: 120 });
    expect(
      usageTokens({ input_tokens: 40, output_tokens: 90, cache_creation_input_tokens: null, cache_read_input_tokens: 3000 }),
    ).toEqual({ tokensIn: 340, tokensOut: 90 });
  });

  it("is safe on missing / partial usage", () => {
    expect(usageTokens(undefined)).toEqual({ tokensIn: 0, tokensOut: 0 });
    expect(usageTokens(null)).toEqual({ tokensIn: 0, tokensOut: 0 });
    expect(usageTokens({ output_tokens: 5 })).toEqual({ tokensIn: 0, tokensOut: 5 });
  });
});
