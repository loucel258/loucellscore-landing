import { afterEach, describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { handleVoiceTurn } from "@/lib/agent-runtime/channels/voice";
import { handleVoiceAfter, handleVoiceIncoming, type TwilioVoiceDeps } from "@/lib/agent-runtime/channels/voice-twilio";
// The real gateway, over a real WebSocket.
import { createGateway } from "../../voice-gateway/src/server";
import { CALLER, OPEN_NOW, SECRET, TRANSFER, setup, streamingModel } from "./helpers";
import { textMsg } from "../runtime/helpers";

/**
 * One whole phone call through every piece we own:
 *   Twilio webhook (/voice/incoming) → TwiML with a signed ticket
 *   → gateway accepts the ticket → signed turns to the app's real handler
 *   → pipeline (with a scripted model and an in-memory store)
 *   → NDJSON back through the gateway as ConversationRelay messages
 *   → caller presses 0 → handoff → /voice/after dials the owner.
 * Only Twilio's side (this test) and the model/database are simulated.
 */

const TOKEN = "twilio-auth-token";
const HOST = "app.example";
const SLUG = "test-agent";

function twilioPost(path: string, params: Record<string, string>): Request {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], `https://${HOST}${path}`);
  const sig = crypto.createHmac("sha1", TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
  return new Request(`https://${HOST}${path}`, {
    method: "POST",
    headers: { host: HOST, "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig },
    body: new URLSearchParams(params),
  });
}

let gw: ReturnType<typeof createGateway> | undefined;
afterEach(async () => {
  await gw?.close();
  gw = undefined;
});

describe("end-to-end simulated call", () => {
  it("greets with the AI disclosure, answers, and transfers to the owner on 0", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const s = setup({
      voice: { transfer_number: TRANSFER },
      model: streamingModel(textMsg("Claro. ¿Qué día le queda bien para la limpieza?")),
    });
    const deps: TwilioVoiceDeps = {
      ...s.deps,
      readCredential: vi.fn(async () => ({ ok: true as const, credential: { access_token: TOKEN } })) as never,
      gatewayUrl: () => "voice.example.com",
    };
    const call = { CallSid: "CA1", From: CALLER, To: "+15617821310" };

    // 1. Twilio: a call comes in.
    const twiml = await (await handleVoiceIncoming(twilioPost(`/api/agent/${SLUG}/voice/incoming`, call), SLUG, deps)).text();
    const ticket = /<Parameter name="ticket" value="([^"]+)"/.exec(twiml)?.[1];
    expect(ticket).toBeTruthy();

    // 2. The gateway, pointed at the app's real turn handler.
    gw = createGateway(
      { appUrl: `https://${HOST}`, secret: SECRET, port: 0 },
      {
        log: () => {},
        now: () => OPEN_NOW,
        charsPerSec: 1e6, // speech "plays" instantly in the test
        fetchImpl: (async (url: string, init: RequestInit) =>
          handleVoiceTurn(new Request(url, init), SLUG, s.deps)) as unknown as typeof fetch,
      },
    );
    const port = await gw.listen(0);
    // Node's built-in WebSocket client plays Twilio.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`);
    const got: Array<Record<string, unknown>> = [];
    ws.addEventListener("message", (e) => got.push(JSON.parse(String(e.data))));
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    const waitFor = async (pred: () => boolean) => {
      const t0 = Date.now();
      while (!pred()) {
        if (Date.now() - t0 > 3000) throw new Error("timeout; got " + JSON.stringify(got));
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    const turns = () => got.filter((m) => m.type === "text" && m.last === true).length;
    const spokenUpTo = (i: number) => {
      // text of turn i (0-based), tokens between the (i)th and (i+1)th last:true
      const out: string[] = [];
      let t = 0;
      for (const m of got) {
        if (m.type !== "text") continue;
        if (t === i && typeof m.token === "string") out.push(m.token);
        if (m.last === true) t++;
      }
      return out.join("").trim();
    };

    // 3. Twilio opens the relay with the ticket: the welcome comes from the app.
    ws.send(JSON.stringify({ type: "setup", callSid: "CA1", from: CALLER, to: call.To, customParameters: { slug: SLUG, ticket } }));
    await waitFor(() => turns() >= 1);
    const welcome = spokenUpTo(0);
    expect(welcome.toLowerCase()).toMatch(/asistente|assistant/);
    expect(welcome.toLowerCase()).toMatch(/grab|record/);

    // 4. The caller speaks (a partial first, then the final transcript).
    ws.send(JSON.stringify({ type: "prompt", voicePrompt: "Necesito", lang: "es-US", last: false }));
    ws.send(JSON.stringify({ type: "prompt", voicePrompt: "Necesito una limpieza de piscina", lang: "es-US", last: true }));
    await waitFor(() => turns() >= 2);
    expect(spokenUpTo(1)).toContain("¿Qué día le queda bien para la limpieza?");
    expect(s.model.stream).toHaveBeenCalledTimes(1);

    // 5. The caller presses 0: the gateway ends the session with a handoff.
    ws.send(JSON.stringify({ type: "dtmf", digit: "0" }));
    await waitFor(() => got.some((m) => m.type === "end"));
    const end = got.find((m) => m.type === "end")!;
    expect(JSON.parse(String(end.handoffData))).toEqual({ reason: "owner_transfer", target: TRANSFER });
    ws.close();

    // 6. Twilio posts the session end to /voice/after: dial the owner.
    const after = await (
      await handleVoiceAfter(
        twilioPost(`/api/agent/${SLUG}/voice/after`, { ...call, SessionStatus: "ended", HandoffData: String(end.handoffData) }),
        SLUG,
        deps,
      )
    ).text();
    expect(after).toContain(`<Number>${TRANSFER}</Number>`);

    // Governance trail: every turn audited, call record kept, escalation filed.
    expect(s.audits.length).toBeGreaterThanOrEqual(3);
    expect(s.store.calls_.get("CA1")?.outcome).toBe("transferred");
    expect(s.store.escalations).toHaveLength(1);
  });
});
