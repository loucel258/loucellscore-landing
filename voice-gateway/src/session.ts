import { randomUUID } from "node:crypto";
import { deriveKey, NonceStore, signBody, verifyTicket } from "./crypto.js";
import { maskPhone, type Logger } from "./log.js";

export const FALLBACK: Record<"en" | "es", string> = {
  en: "Sorry, I'm having trouble. Let me get someone to call you back.",
  es: "Lo siento, estoy teniendo problemas. Haré que alguien le devuelva la llamada.",
};
/** Said once after a silence. */
export const STILL_THERE: Record<"en" | "es", string> = {
  en: "Are you still there?",
  es: "¿Sigue ahí?",
};
/** Said before hanging up after a second silence. */
export const SILENT_GOODBYE: Record<"en" | "es", string> = {
  en: "I can't seem to hear you. Thanks for calling, have a good day.",
  es: "Parece que no le escucho. Gracias por llamar, que tenga buen día.",
};
/** Said when the call reaches its hard length cap. */
export const TIME_UP: Record<"en" | "es", string> = {
  en: "I need to end the call now. Thanks for calling, have a good day.",
  es: "Debo terminar la llamada ahora. Gracias por llamar, que tenga buen día.",
};
const TTS_LANG: Record<"en" | "es", string> = { en: "en-US", es: "es-US" };

export const FIRST_BYTE_TIMEOUT_MS = 8000;
export const TOTAL_TIMEOUT_MS = 30000;
/** Silence after the agent finished speaking before "are you still there?". */
export const IDLE_MS = 10_000;
/** Phone speech rate used to estimate how long queued text takes to play (~150 wpm). */
export const CHARS_PER_SEC = 14;

/** Minimal socket surface (real `ws` WebSocket satisfies it). */
export interface RelaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SessionDeps {
  appUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
  now?: () => number; // ms
  log: Logger;
  firstByteTimeoutMs?: number;
  totalTimeoutMs?: number;
  idleMs?: number;
  charsPerSec?: number;
  /** Shared across sessions so a ticket opens one call only. */
  nonces?: NonceStore;
}

type Lang = "en" | "es";
type TurnBody = {
  slug: string;
  callSid: string;
  from: string;
  to: string;
  callerVerified: boolean;
  turnId: string;
  event: "start" | "utterance" | "dtmf" | "end";
  text?: string;
  lang?: Lang | null;
  dtmf?: string;
  interruptedAgentText?: string;
};

function toLang(v: unknown): Lang | null {
  if (typeof v !== "string") return null;
  const p = v.toLowerCase().slice(0, 2);
  return p === "en" || p === "es" ? p : null;
}

export class CallSession {
  private key: Buffer;
  private fetchImpl: typeof fetch;
  private now: () => number;
  private ready = false;
  private closed = false;
  /** An end was scheduled (after the last words play); caller input is ignored. */
  private ending = false;
  slug = "";
  callSid = "";
  from = "";
  to = "";
  verified = false;
  lang: Lang = "en";
  private turn: AbortController | null = null;
  private turnSeq = 0;
  /** text sent to the caller during the current/last turn */
  private spoken = "";
  private pendingInterrupted: string | null = null;
  /** serializes turns so tokens never interleave */
  private chain: Promise<void> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleStage = 0;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private ws: RelaySocket, private deps: SessionDeps) {
    this.key = deriveKey(deps.secret);
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  /** Feed one raw ConversationRelay message. */
  onMessage(raw: string): void {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.type === "setup") {
      this.onSetup(m);
      return;
    }
    if (!this.ready || this.ending) return;
    switch (m.type) {
      case "prompt":
        // The caller is talking: no silence prompt while they do.
        this.clearIdle();
        // last:false = partial transcript, ignore; act on the final one only.
        if (m.last === false) return;
        if (typeof m.voicePrompt === "string" && m.voicePrompt.trim()) {
          const lang = toLang(m.lang);
          if (lang) this.lang = lang;
          this.idleStage = 0;
          this.startTurn({ event: "utterance", text: m.voicePrompt, lang });
        }
        break;
      case "interrupt":
        this.clearIdle();
        this.onInterrupt(m);
        break;
      case "dtmf":
        this.clearIdle();
        this.idleStage = 0;
        if (typeof m.digit === "string") this.startTurn({ event: "dtmf", dtmf: m.digit });
        break;
      case "error":
        this.deps.log("relay_error", { callSid: this.callSid }); // description may hold content: not logged
        break;
    }
  }

  private reject(reason: string): void {
    this.deps.log("ticket_rejected", { reason });
    this.ws.close(1008, "unauthorized");
    this.closed = true;
  }

  private onSetup(m: Record<string, unknown>): void {
    if (this.ready || this.closed) return;
    const params = (m.customParameters ?? {}) as Record<string, unknown>;
    const nowS = Math.floor(this.now() / 1000);
    const res = verifyTicket(this.key, params.ticket, params.slug, nowS);
    if (!res.ok) return this.reject(res.reason);
    const t = res.claims;
    // The ticket was minted for one call: the relay must be that call, and only once.
    if (String(m.callSid ?? "") !== t.callSid) return this.reject("call_mismatch");
    if (this.deps.nonces && !this.deps.nonces.use(t.nonce, t.exp, nowS)) return this.reject("replayed");
    this.ready = true;
    this.slug = t.slug;
    this.callSid = t.callSid.slice(0, 64);
    // Caller identity comes from the Twilio-signed webhook (via the ticket), never from the socket.
    this.from = t.from;
    this.to = t.to;
    this.verified = t.verified;
    this.deps.log("call_start", {
      callSid: this.callSid,
      slug: this.slug,
      from: maskPhone(this.from),
      to: maskPhone(this.to),
      verified: this.verified,
    });
    this.capTimer = setTimeout(() => this.wrapUp(TIME_UP, "time_cap"), (t.maxMin + 1) * 60_000);
    this.startTurn({ event: "start", lang: null });
  }

  private onInterrupt(m: Record<string, unknown>): void {
    const until = typeof m.utteranceUntilInterrupt === "string" ? m.utteranceUntilInterrupt : this.spoken;
    this.pendingInterrupted = until || null;
    this.turn?.abort(new Error("interrupt"));
    this.deps.log("interrupt", { callSid: this.callSid });
  }

  private startTurn(partial: Partial<TurnBody> & { event: TurnBody["event"] }): void {
    // A new caller turn supersedes whatever is still in flight.
    this.turn?.abort(new Error("superseded"));
    const ac = new AbortController();
    this.turn = ac;
    const seq = ++this.turnSeq;
    const interrupted = this.pendingInterrupted ?? undefined;
    if (partial.event === "utterance" || partial.event === "dtmf") this.pendingInterrupted = null;
    const body: TurnBody = {
      slug: this.slug,
      callSid: this.callSid,
      from: this.from,
      to: this.to,
      callerVerified: this.verified,
      turnId: randomUUID(),
      ...partial,
      ...(interrupted && partial.event !== "start" ? { interruptedAgentText: interrupted } : {}),
    } as TurnBody;
    this.chain = this.chain.then(() => this.runTurn(body, ac, seq)).catch(() => {});
  }

  private send(obj: unknown): void {
    if (this.closed) return;
    try {
      this.ws.send(JSON.stringify(obj));
    } catch {
      /* socket gone */
    }
  }

  private speak(token: string): void {
    this.spoken += token;
    this.send({ type: "text", token, last: false });
  }

  private flush(): void {
    this.send({ type: "text", token: "", last: true });
  }

  /** How long the text just queued takes to play, roughly. */
  private playMs(text: string): number {
    return Math.min(60_000, Math.round((text.length / (this.deps.charsPerSec ?? CHARS_PER_SEC)) * 1000));
  }

  /**
   * End the session once the last words have played: an `end` sent right
   * after the text could cut "I'm connecting you" in half.
   */
  private endAfterSpeech(handoffData?: string): void {
    this.ending = true;
    this.clearIdle();
    this.turn?.abort(new Error("ending"));
    const delay = this.playMs(this.spoken) + 400;
    this.endTimer = setTimeout(() => {
      this.send(handoffData === undefined ? { type: "end" } : { type: "end", handoffData });
    }, delay);
  }

  /** Say a fixed line and end the call (silence, length cap). */
  private wrapUp(lines: Record<Lang, string>, reason: string): void {
    if (this.closed || this.ending) return;
    this.turnSeq++; // any turn still in flight is superseded
    this.turn?.abort(new Error(reason));
    this.deps.log("wrap_up", { callSid: this.callSid, reason });
    this.spoken = "";
    this.speak(lines[this.lang]);
    this.flush();
    this.endAfterSpeech();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** After the agent finishes a turn: wait for the words to play, then for the caller. */
  private armIdle(): void {
    this.clearIdle();
    if (this.closed || this.ending) return;
    const idle = this.deps.idleMs ?? IDLE_MS;
    this.idleTimer = setTimeout(() => this.onIdle(), this.playMs(this.spoken) + idle);
  }

  private onIdle(): void {
    this.idleTimer = null;
    if (this.closed || this.ending) return;
    if (this.idleStage === 0) {
      this.idleStage = 1;
      this.deps.log("silence", { callSid: this.callSid });
      this.spoken = "";
      this.speak(STILL_THERE[this.lang]);
      this.flush();
      this.armIdle();
      return;
    }
    this.wrapUp(SILENT_GOODBYE, "silence");
  }

  private async runTurn(body: TurnBody, ac: AbortController, seq: number): Promise<void> {
    if (this.closed || ac.signal.aborted) return;
    this.spoken = "";
    const raw = JSON.stringify(body);
    const url = `${this.deps.appUrl.replace(/\/+$/, "")}/api/agent/${encodeURIComponent(this.slug)}/voice/turn`;
    const firstByteMs = this.deps.firstByteTimeoutMs ?? FIRST_BYTE_TIMEOUT_MS;
    const totalMs = this.deps.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
    let timedOut = false;
    const abortTimeout = () => {
      timedOut = true;
      ac.abort(new Error("timeout"));
    };
    let firstByteTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(abortTimeout, firstByteMs);
    const totalTimer = setTimeout(abortTimeout, totalMs);
    let handoff: { reason?: string; target?: string } | null = null;
    let hangup = false;
    let failed = false;
    let sawEndTurn = false;

    const onLine = (line: string) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ac.signal.aborted) return;
      switch (ev.type) {
        case "text":
          if (typeof ev.token === "string" && ev.token) this.speak(ev.token);
          break;
        case "language": {
          const l = toLang(ev.lang);
          if (l) {
            this.lang = l;
            this.send({ type: "language", ttsLanguage: TTS_LANG[l], transcriptionLanguage: TTS_LANG[l] });
          }
          break;
        }
        case "handoff":
          handoff = { reason: String(ev.reason ?? ""), target: String(ev.target ?? "") };
          break;
        case "hangup":
          hangup = true;
          break;
        case "end_turn":
          sawEndTurn = true;
          break;
        case "error":
          failed = true;
          break;
      }
    };

    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...signBody(this.key, raw, Math.floor(this.now() / 1000)) },
        body: raw,
        signal: ac.signal,
      });
      if (body.event === "start" && res.status === 409) {
        // The app already has a live session for this call (a replayed ticket): drop this one.
        await res.body?.cancel().catch(() => {});
        clearTimeout(totalTimer);
        if (firstByteTimer) clearTimeout(firstByteTimer);
        this.deps.log("ticket_rejected", { reason: "call_already_started" });
        this.ready = false;
        this.ws.close(1008, "unauthorized");
        this.closed = true;
        return;
      }
      if (!res.ok || !res.body) {
        failed = true;
      } else if (body.event === "end") {
        await res.body.cancel().catch(() => {});
      } else {
        const reader = res.body.getReader();
        // Make the body read abort-aware even if the fetch impl doesn't error the stream.
        const onAbort = () => void reader.cancel().catch(() => {});
        ac.signal.addEventListener("abort", onAbort, { once: true });
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (firstByteTimer) {
            clearTimeout(firstByteTimer);
            firstByteTimer = undefined;
          }
          if (done || ac.signal.aborted) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line) onLine(line);
          }
        }
        buf += dec.decode();
        if (buf.trim()) onLine(buf.trim());
        // A handoff or hangup also closes the turn; anything else without
        // end_turn is a timeout or a truncated stream.
        const complete = sawEndTurn || handoff !== null || hangup;
        if (timedOut || (!complete && !failed && !ac.signal.aborted)) failed = true;
      }
    } catch {
      if (ac.signal.aborted && !timedOut) {
        // interrupted/superseded: stay silent, caller already took the floor
        clearTimeout(totalTimer);
        if (firstByteTimer) clearTimeout(firstByteTimer);
        return;
      }
      // Timeout, app unreachable, or the stream dropped mid-reply: the caller
      // must hear the fallback, never silence.
      failed = true;
    } finally {
      clearTimeout(totalTimer);
      if (firstByteTimer) clearTimeout(firstByteTimer);
    }

    if (seq !== this.turnSeq || (ac.signal.aborted && !timedOut)) return; // superseded
    if (body.event === "end" || this.ending) return;

    if (failed) {
      this.deps.log("turn_failed", { callSid: this.callSid, turnEvent: body.event, timedOut });
      this.speak(FALLBACK[this.lang]);
      this.flush();
      this.armIdle();
      return;
    }
    this.flush();
    if (handoff) {
      this.deps.log("handoff", { callSid: this.callSid });
      this.endAfterSpeech(JSON.stringify(handoff));
    } else if (hangup) {
      this.deps.log("hangup", { callSid: this.callSid });
      this.endAfterSpeech();
    } else {
      this.armIdle();
    }
  }

  /** Socket closed: tell the app the call is over (best effort, short timeout). */
  async onClose(): Promise<void> {
    for (const t of [this.idleTimer, this.capTimer, this.endTimer]) if (t) clearTimeout(t);
    if (this.closed && !this.ready) return;
    this.closed = true;
    this.turn?.abort(new Error("closed"));
    if (!this.ready) return;
    this.deps.log("call_end", { callSid: this.callSid });
    const raw = JSON.stringify({
      slug: this.slug,
      callSid: this.callSid,
      from: this.from,
      to: this.to,
      callerVerified: this.verified,
      turnId: randomUUID(),
      event: "end",
      lang: this.lang,
    });
    const url = `${this.deps.appUrl.replace(/\/+$/, "")}/api/agent/${encodeURIComponent(this.slug)}/voice/turn`;
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...signBody(this.key, raw, Math.floor(this.now() / 1000)) },
        body: raw,
        signal: AbortSignal.timeout(3000),
      });
      await res.body?.cancel().catch(() => {});
    } catch {
      /* fire and forget */
    }
  }
}
