import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Structural guard for TCPA gating: every proactive SMS/WhatsApp must go
 * through sendProactiveGated (src/lib/notify/proactive.ts), which checks
 * opt-out, consent and quiet hours. The only other module allowed to call
 * the raw senders is the inbound SMS webhook (replies to a customer who just
 * texted us). Anything new that imports sendSms / sendWhatsApp fails here
 * and must be routed through the gate instead.
 */

const SRC = path.resolve(__dirname, "../../src");

const ALLOWED = new Set([
  "lib/notify/twilio.ts", // defines the raw senders
  "lib/notify/proactive.ts", // the gate
  "lib/agent-runtime/channels/sms.ts", // inbound reply path (the /api/agent/[slug]/sms adapter)
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

// Named import of a raw sender from the twilio module (any import style).
// `[^}]` already spans newlines, so no dotAll flag is needed (target < ES2018).
const RAW_SENDER_IMPORT =
  /import\s*(?:type\s*)?\{[^}]*\b(sendSms|sendWhatsApp)\b[^}]*\}\s*from\s*["'][^"']*notify\/twilio["']/;
// Namespace / default import of the twilio module would also expose them.
const NAMESPACE_IMPORT = /import\s+\*\s+as\s+\w+\s+from\s*["'][^"']*notify\/twilio["']/;
const DYNAMIC_IMPORT = /import\(\s*["'][^"']*notify\/twilio["']\s*\)/;

describe("proactive SMS choke point", () => {
  const files = walk(SRC);

  it("scans a non-trivial tree (sanity)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("detector catches single-line, multi-line and namespace imports (sanity)", () => {
    expect(RAW_SENDER_IMPORT.test('import { sendSms } from "@/lib/notify/twilio";')).toBe(true);
    expect(RAW_SENDER_IMPORT.test('import {\n  maskPhone,\n  sendWhatsApp,\n} from "../notify/twilio";')).toBe(true);
    expect(RAW_SENDER_IMPORT.test('import { maskPhone } from "@/lib/notify/twilio";')).toBe(false);
    expect(NAMESPACE_IMPORT.test('import * as tw from "@/lib/notify/twilio";')).toBe(true);
  });

  it("only the gate and the inbound SMS reply path import sendSms / sendWhatsApp", () => {
    const offenders = files
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => {
        const text = readFileSync(path.join(SRC, rel), "utf8");
        return RAW_SENDER_IMPORT.test(text) || NAMESPACE_IMPORT.test(text) || DYNAMIC_IMPORT.test(text);
      });
    expect(offenders, `route these through sendProactiveGated: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the gate no longer exports an ungated sender", () => {
    const gate = readFileSync(path.join(SRC, "lib/notify/proactive.ts"), "utf8");
    expect(gate).toMatch(/export async function sendProactiveGated\(/);
    expect(gate).not.toMatch(/export (async )?function sendProactive\(/);
  });
});
