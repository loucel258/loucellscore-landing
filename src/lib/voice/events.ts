/** What a voice turn produces, before a transport (NDJSON, SSE) serializes it. */
export type VoiceEvent =
  | { type: "text"; token: string }
  | { type: "language"; lang: "en" | "es" }
  | { type: "handoff"; reason: string; target: string }
  | { type: "hangup"; reason: string }
  | { type: "error"; code: string }
  | { type: "end_turn" };

export type VoiceEmit = (event: VoiceEvent) => void;

export const ndjsonLine = (event: VoiceEvent): string => `${JSON.stringify(event)}\n`;
