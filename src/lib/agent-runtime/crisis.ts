import type { Locale } from "./types";

/**
 * Crisis and emergency protocol: deterministic detection + fixed replies.
 * Runs BEFORE the model (steps/crisis.ts). Pure module (no I/O).
 *
 * The pattern set is deliberately conservative: it matches first-person
 * intent phrases and unambiguous emergency phrases, not single words, so
 * "I'm dying to get my nails done" and "me muero de ganas" pass through.
 * A false positive costs one safe message and an alert; a miss costs more.
 *
 * Text is normalized first (lowercase, accents stripped, curly apostrophes
 * straightened), so the patterns below are plain ASCII.
 */

export type CrisisKind = "self_harm" | "emergency";
export type EmergencyType = "gas" | "fire" | "smoke" | "carbon_monoxide" | "electrical" | "medical";

export type CrisisMatch = {
  kind: CrisisKind;
  /** Set when kind = "emergency". */
  emergency?: EmergencyType;
  /** Language of the phrase that matched (the reply uses it, else the channel locale). */
  lang: Locale;
};

export function normalizeForCrisis(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type Rule = { re: RegExp; lang: Locale };

const SELF_HARM: Rule[] = [
  // English
  {
    lang: "en",
    re: /\b(kill(ing)? myself|end(ing)? my (own )?life|take my (own )?life|taking my own life|commit(ting)? suicide|suicidal|thinking (about|of) suicide|hurt(ing)? myself|harm(ing)? myself|cut(ting)? myself|end it all|better off dead|i'?d be better off without me)\b/,
  },
  { lang: "en", re: /\b(want|wanna|plan(ning)?) to (die|disappear forever)\b(?!\s+(of|from|laughing|inside a little))/ },
  { lang: "en", re: /\bi (don'?t|do not) want to (live|be alive|be here anymore|exist)\b/ },
  { lang: "en", re: /\b(no reason|nothing) to live for\b/ },
  // Spanish (accents already stripped)
  {
    lang: "es",
    re: /\b(quiero matarme|me quiero matar|me voy a matar|voy a matarme|quitarme la vida|quitarme mi vida|acabar con mi vida|terminar con mi vida|acabar con todo|suicidarme|suicidio|suicida|hacerme dano|lastimarme|hacerme algo malo|cortarme las venas|mejor estaria muert[oa])\b/,
  },
  { lang: "es", re: /\b(quiero morirme|quiero morir|me quiero morir|ya no quiero vivir|no quiero vivir|no quiero seguir viviendo|ya no quiero estar aqui)\b(?!\s+de\b)/ },
  { lang: "es", re: /\bno tengo (nada|ninguna razon) (por|para) (que )?vivir\b/ },
];

type EmergencyRule = Rule & { type: EmergencyType };

const EMERGENCY: EmergencyRule[] = [
  // Gas
  { type: "gas", lang: "en", re: /\b(gas leak|gas is leaking|leaking gas|smell(s|ing)? (of |like )?(natural )?gas|gas smell|smells? like gas|rotten eggs? smell|smell(s|ing)? (like )?rotten eggs?)\b/ },
  { type: "gas", lang: "es", re: /\b(fuga de gas|(?<!no )hay gas|huele a gas|me huele a gas|huelo gas|huele mucho a gas|olor a gas|se escapa el gas|gas se esta saliendo)\b/ },
  // Fire
  { type: "fire", lang: "en", re: /(?<!\byou'?re )(?<!\byou are )(?<!\byoure )\b(on fire|caught fire|catching fire|there'?s a fire|there is a fire|we have a fire|fire broke out|fire started|smell(s|ing)? (like )?(something )?burning)\b/ },
  { type: "fire", lang: "es", re: /\b(incendio|esta en llamas|se incendia|se incendio|se esta quemando|hay fuego|se prendio fuego|huele a quemado)\b/ },
  // Smoke
  { type: "smoke", lang: "en", re: /\b(smell(s|ing)? (of )?smoke|see(ing)? smoke|smoke (is )?(coming|pouring)|filled with smoke|full of smoke|thick smoke|smoke alarm (is )?(going off|beeping)|there'?s smoke)\b/ },
  { type: "smoke", lang: "es", re: /\b(huele a humo|hay humo|mucho humo|sale humo|sale mucho humo|lleno de humo|alarma de humo)\b/ },
  // Carbon monoxide
  { type: "carbon_monoxide", lang: "en", re: /\b(carbon monoxide|co (alarm|detector) (is )?(going off|beeping))\b/ },
  { type: "carbon_monoxide", lang: "es", re: /\b(monoxido de carbono)\b/ },
  // Electrical shock / electrocution
  { type: "electrical", lang: "en", re: /\b(electrocuted|electric shock|electrical fire|got shocked|shocked me)\b/ },
  { type: "electrical", lang: "es", re: /\b(electrocut\w+|choque electrico|me dio corriente|incendio electrico)\b/ },
  // Medical emergencies
  { type: "medical", lang: "en", re: /\b(unconscious|unresponsive|not breathing|isn'?t breathing|stopped breathing|can'?t breathe|cannot breathe|passed out|not waking up|won'?t wake up|collapsed|having a seizure|heart attack|chest pain|anaphyla\w+|throat (is )?(closing|swelling)|severe allergic reaction|bleeding (heavily|badly|won'?t stop)|won'?t stop bleeding|medical emergency|need an ambulance|call(ing)? 911)\b/ },
  { type: "medical", lang: "es", re: /\b(inconsciente|no respira|dejo de respirar|no puedo respirar|se desmayo|se desmayaron|no reacciona|no despierta|convulsion|convulsiones|infarto|ataque al corazon|dolor de pecho|anafilaxia|reaccion alergica (grave|severa)|se me cierra la garganta|garganta cerrandose|sangrado (fuerte|no para)|no deja de sangrar|emergencia medica|necesito una ambulancia|llamar al 911)\b/ },
];

const SPARK_RE = /\b(sparks?|sparking|chispas?|chispeando)\b/;
const WATER_RE = /\b(water|wet|flood(ed|ing)?|leak(ing)?|dripping|soaked|agua|mojad[oa]|inundad[oa]|inundacion|gotea|goteando|fuga)\b/;

/** Detect a self-harm or emergency message, or null. Self-harm wins when both match. */
export function detectCrisis(raw: string): CrisisMatch | null {
  if (!raw || raw.length > 4000) return raw ? detectCrisis(raw.slice(0, 4000)) : null;
  const text = normalizeForCrisis(raw);
  if (!text) return null;

  for (const r of SELF_HARM) if (r.re.test(text)) return { kind: "self_harm", lang: r.lang };
  for (const r of EMERGENCY) if (r.re.test(text)) return { kind: "emergency", emergency: r.type, lang: r.lang };
  // Sparks next to water is an electrical emergency; either word alone is not.
  if (SPARK_RE.test(text) && WATER_RE.test(text)) {
    return { kind: "emergency", emergency: "electrical", lang: /chisp/.test(text) ? "es" : "en" };
  }
  return null;
}

// ── Fixed replies ──────────────────────────────────────────────────────────

export const SELF_HARM_REPLY: Record<Locale, string> = {
  en: "If you're thinking about hurting yourself, please call or text 988 (Suicide & Crisis Lifeline) now. If you're in immediate danger, call 911.",
  es: "Si estás pensando en hacerte daño, llama o escribe al 988 ahora mismo (Línea de Prevención del Suicidio y Crisis, tiene atención en español). Si estás en peligro inmediato, llama al 911.",
};

const EMERGENCY_BASE: Record<Locale, string> = {
  en: "This sounds like an emergency. Please call 911 now.",
  es: "Esto parece una emergencia. Por favor llama al 911 ahora mismo.",
};

const LEAVE_AREA: Record<Locale, string> = {
  en: "Leave the area right away and call from a safe place.",
  es: "Sal del lugar de inmediato y llama desde un lugar seguro.",
};

const TEAM_ALERTED: Record<Locale, string> = {
  en: "We also alerted the team.",
  es: "También avisamos al equipo.",
};

const NEEDS_EVACUATION: ReadonlySet<EmergencyType> = new Set(["gas", "fire", "smoke", "carbon_monoxide", "electrical"]);

/**
 * The fixed safe message. `teamNotified` adds the "we alerted the team" line
 * to emergencies only when the alert really went out. Self-harm replies are
 * never extended.
 */
export function crisisReply(match: CrisisMatch, locale: Locale, teamNotified: boolean): string {
  if (match.kind === "self_harm") return SELF_HARM_REPLY[locale];
  const parts = [EMERGENCY_BASE[locale]];
  if (match.emergency && NEEDS_EVACUATION.has(match.emergency)) parts.push(LEAVE_AREA[locale]);
  if (teamNotified) parts.push(TEAM_ALERTED[locale]);
  return parts.join(" ");
}
