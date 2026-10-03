import { describe, it, expect } from "vitest";
import { renderForChannel, sentenceEnd, speakableSentences, toSpoken } from "@/lib/agents/render";
import { SpeechStream } from "@/lib/voice/speech";
import { detectLang } from "@/lib/voice/lang";
import { buildPrompt, VOICE_STYLE } from "@/lib/agent-runtime/steps/prompt";
import { toAgentConfig } from "@/lib/agent-runtime/config";
import { agentFixture } from "../runtime/helpers";
import { isSpokenOptOut, parseSpokenConfirmation, ALL_CONFIRMATION_PHRASES } from "@/lib/agent-runtime/spoken";
import { parseSmsKeyword } from "@/lib/booking/gates";

describe("voice rendering", () => {
  it("strips markdown, links, urls and emojis", () => {
    const out = toSpoken("**Hola** 😊 mira [aquí](https://x.com/a) o https://y.com/b. # Título\n- uno\n- dos");
    expect(out).not.toMatch(/[*#\[\]]|https?:|😊/);
    expect(out).toContain("Hola");
    expect(out).toContain("aquí");
  });
  it("says prices, times and phone numbers the way people do", () => {
    expect(toSpoken("Cuesta $45.", "es")).toBe("Cuesta 45 dólares.");
    expect(toSpoken("It's $45.50 today", "en")).toBe("It's 45 dollars and 50 cents today");
    expect(toSpoken("A las 3:00 p. m. o 3:30 PM", "es")).toBe("A las 3 PM o 3:30 PM");
    expect(toSpoken("Llámenos al (561) 555-0123", "es")).toBe("Llámenos al 5 6 1, 5 5 5, 0 1 2 3");
  });
  it("splits into speakable sentences without cutting abbreviations or times", () => {
    expect(speakableSentences("Perfecto. Tu cita es a las 3:00 p. m. del martes. ¿Te sirve?", "es")).toEqual([
      "Perfecto.",
      "Tu cita es a las 3 PM del martes.",
      "¿Te sirve?",
    ]);
    expect(speakableSentences("Habla con la Dra. López hoy. Gracias.", "es")).toEqual(["Habla con la Dra. López hoy.", "Gracias."]);
  });
  it("renderForChannel(voice) joins them", () => {
    expect(renderForChannel("**Hi!** Call us. Thanks", "voice")).toBe("Hi! Call us. Thanks");
  });
  it("sentenceEnd waits for the next word", () => {
    expect(sentenceEnd("Hola.")).toBe(-1);
    expect(sentenceEnd("Hola. Qué")).toBe(6);
  });
});

describe("SpeechStream", () => {
  const run = (deltas: string[], locale: "en" | "es" = "es") => {
    const out: string[] = [];
    const s = new SpeechStream((t) => out.push(t), locale);
    for (const d of deltas) s.push(d);
    s.flush();
    return out;
  };
  it("emits whole sentences as they complete", () => {
    expect(run(["Claro, te ayudo. ¿Qué dí", "a prefieres? Mañana tengo es", "pacio."])).toEqual([
      "Claro, te ayudo. ",
      "¿Qué día prefieres? ",
      "Mañana tengo espacio. ",
    ]);
  });
  it("lets the first chunk leave at a comma once it is long enough", () => {
    const out = run(["Con gusto le ayudo con su cita de mañana, ", "dígame qué hora le queda mejor."]);
    expect(out[0]).toBe("Con gusto le ayudo con su cita de mañana, ");
    expect(out).toHaveLength(2);
  });
  it("renders each chunk (no markdown or links reach the TTS)", () => {
    expect(run(["**Listo.** Mira [esto](https://a.com). Fin"]).join("")).not.toMatch(/[*\[\]]|https?:/);
  });
});

describe("language detection", () => {
  it("needs a clear majority", () => {
    expect(detectLang("I would like to book an appointment please")).toBe("en");
    expect(detectLang("quiero una cita para mañana por favor")).toBe("es");
    expect(detectLang("ok gracias")).toBeNull();
    expect(detectLang("quiero una appointment")).toBeNull();
  });
});

describe("voice prompt style", () => {
  const config = toAgentConfig(agentFixture({ integrations: { locale: "es", kb: "Abrimos de lunes a sábado." } }))!;
  const prompt = buildPrompt({ config, channel: "voice", locale: "es", tools: [], services: [] });

  it("carries the spoken-language rules", () => {
    for (const rule of [
      "ONE question at a time",
      "No lists, no markdown, no emojis",
      "the way a person says them",
      "Confirm names and phone numbers back",
      "Claro",
      "upset",
      "Never claim to be human",
    ]) {
      expect(VOICE_STYLE).toContain(rule);
    }
    expect(prompt.system).toContain(VOICE_STYLE);
    expect(prompt.system).toContain("Abrimos de lunes a sábado.");
    expect(prompt.system).toContain("phone front-desk assistant");
  });
  it("shows a pending confirmation to the model without letting it execute", () => {
    const p = buildPrompt({ config, channel: "voice", locale: "es", tools: [], services: [], pending: { summary: "Cancel your Gel appointment?" } });
    expect(p.dynamic).toContain("PENDING CONFIRMATION");
    expect(p.dynamic).toContain("handled by the system, not by you");
  });
});

describe("spoken confirmation and opt-out words", () => {
  it("exact yes / no phrases only", () => {
    for (const y of ["Yes.", "Sí, por favor.", "yeah", "Claro", "dale", "that's right", "Sí, adelante"]) {
      expect(parseSpokenConfirmation(y)?.kind, y).toBe("confirm");
    }
    for (const n of ["No.", "No, gracias", "no, mejor no", "nope", "never mind"]) {
      expect(parseSpokenConfirmation(n)?.kind, n).toBe("decline");
    }
    for (const other of ["yes but make it friday", "sí pero a las cuatro", "maybe", "no sé"]) {
      expect(parseSpokenConfirmation(other), other).toBeNull();
    }
  });
  it("no confirmation phrase is an opt-out keyword", () => {
    for (const p of ALL_CONFIRMATION_PHRASES) expect(parseSmsKeyword(p)?.kind === "opt_out", p).toBe(false);
  });
  it("opt-out is an explicit phrase, never a bare stop", () => {
    for (const p of ["stop texting me", "please don't call me again", "unsubscribe", "no me escriban más", "quítenme de la lista", "remove me from your list"]) {
      expect(isSpokenOptOut(p), p).toBe(true);
    }
    for (const p of ["stop", "wait stop talking", "cancel my appointment", "no gracias"]) expect(isSpokenOptOut(p), p).toBe(false);
  });
});
