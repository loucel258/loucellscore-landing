/**
 * Cheap language switch detector for a call (pure). Speech-to-text runs in
 * one language at a time; when the caller clearly speaks the other one, the
 * app tells the gateway to switch (event "language"). Needs at least three
 * words and a clear majority, so one borrowed word never flips the call.
 */

const ES = new Set(
  "que el la los las de del por para quiero necesito una un cita hola gracias buenas buenos tengo puedo mi es con si como cuando favor puede podria quisiera agendar cambiar cancelar mañana hoy tarde noche manana donde cuanto cuesta usted ustedes estoy estan".split(" "),
);
const EN = new Set(
  "the and i you my can need want appointment hello please thanks thank is to for with have would like what when book change cancel tomorrow today afternoon morning tonight where how much does your are am could this that".split(" "),
);

export function detectLang(text: string): "en" | "es" | null {
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 3) return null;
  let es = 0;
  let en = 0;
  for (const w of words) {
    if (ES.has(w)) es++;
    if (EN.has(w)) en++;
  }
  if (es - en >= 2) return "es";
  if (en - es >= 2) return "en";
  return null;
}
