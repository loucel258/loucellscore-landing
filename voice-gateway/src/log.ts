export function maskPhone(v: string | undefined | null): string {
  if (!v) return "";
  const s = String(v);
  return s.length <= 4 ? "****" : `***${s.slice(-4)}`;
}

export type Logger = (event: string, fields?: Record<string, unknown>) => void;

/** JSON line logger. Never pass transcripts or full phone numbers. */
export const consoleLogger: Logger = (event, fields = {}) => {
  // The event name wins over any same-named field.
  console.log(JSON.stringify({ t: new Date().toISOString(), ...fields, event }));
};
