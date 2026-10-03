import { sentenceEnd, toSpoken } from "@/lib/agents/render";

/**
 * SpeechStream: raw model deltas in, speakable chunks out.
 *
 * Text is held until a sentence is complete (so markdown, "3 p. m." and
 * prices are rendered whole), except that the very first chunk of a turn may
 * leave at a comma once it is long enough: first audio sooner, same words.
 * Each chunk is emitted in spoken form (render.ts toSpoken) with a trailing
 * space, so the gateway can concatenate tokens.
 */

const FIRST_CHUNK_MIN_CHARS = 28;

export class SpeechStream {
  private buf = "";
  private emittedAny = false;
  /** Everything emitted so far, joined (what the caller heard). */
  spoken = "";

  constructor(
    private readonly emit: (token: string) => void,
    private readonly locale: "en" | "es",
  ) {}

  push(delta: string): void {
    if (!delta) return;
    this.buf += delta;
    for (;;) {
      const end = sentenceEnd(this.buf);
      if (end > 0) {
        this.out(this.buf.slice(0, end));
        this.buf = this.buf.slice(end);
        continue;
      }
      if (!this.emittedAny) {
        const m = /^[^,;:]{28,},\s+(?=\S)/.exec(this.buf);
        if (m && m[0].length >= FIRST_CHUNK_MIN_CHARS) {
          this.out(m[0]);
          this.buf = this.buf.slice(m[0].length);
          continue;
        }
      }
      return;
    }
  }

  /** End of the text: emit whatever is left. */
  flush(): void {
    if (this.buf.trim()) this.out(this.buf);
    this.buf = "";
  }

  /** Speak a whole line (welcome, filler, deterministic reply). */
  say(text: string): void {
    this.flush();
    this.out(text);
  }

  get hasSpoken(): boolean {
    return this.emittedAny;
  }

  private out(raw: string): void {
    const text = toSpoken(raw, this.locale);
    if (!text) return;
    this.emittedAny = true;
    this.spoken = this.spoken ? `${this.spoken} ${text}` : text;
    this.emit(`${text} `);
  }
}
