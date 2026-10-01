import { describe, it, expect } from "vitest";
import { renderForChannel, capAtBoundary, SMS_MAX_CHARS } from "@/lib/agents/render";

describe("renderForChannel(text, 'sms')", () => {
  it("strips bold, headings and bullet markers but keeps line breaks", () => {
    const md = "## Horario\n**Martes a sábado**, 9am a 6pm.\n\n- Gel: $45\n* Pedicure: $50\n• Acrílico: $60";
    expect(renderForChannel(md, "sms")).toBe(
      "Horario\nMartes a sábado, 9am a 6pm.\n\nGel: $45\nPedicure: $50\nAcrílico: $60",
    );
  });

  it("turns markdown links into 'label: url'", () => {
    expect(renderForChannel("Reserva [aquí](https://nailestudio.vercel.app/book).", "sms")).toBe(
      "Reserva aquí: https://nailestudio.vercel.app/book.",
    );
    expect(renderForChannel("[https://a.example/x](https://a.example/x)", "sms")).toBe("https://a.example/x");
  });

  it("removes italics, underscores-bold and code ticks without touching snake_case or URLs", () => {
    expect(renderForChannel("Es *muy* fácil y __rápido__. Usa `CONFIRMAR`.", "sms")).toBe(
      "Es muy fácil y rápido. Usa CONFIRMAR.",
    );
    expect(renderForChannel("Ver https://x.example/a_b_c y gel_polish", "sms")).toBe(
      "Ver https://x.example/a_b_c y gel_polish",
    );
  });

  it("collapses runs of blank lines", () => {
    expect(renderForChannel("Hola\n\n\n\nTe esperamos", "sms")).toBe("Hola\n\nTe esperamos");
  });

  it("leaves short plain text untouched", () => {
    const t = "Tienes cita el martes a las 3pm. Te esperamos!";
    expect(renderForChannel(t, "sms")).toBe(t);
  });

  it("caps long replies at a sentence boundary", () => {
    const sentence = "Tenemos disponibilidad el martes por la tarde y el miércoles por la mañana. ";
    const long = sentence.repeat(12);
    const out = renderForChannel(long, "sms");
    expect(out.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    expect(out.endsWith(".")).toBe(true);
  });

  it("falls back to a word boundary with an ellipsis when there is no sentence end", () => {
    const words = "palabra ".repeat(100);
    const out = capAtBoundary(words.trim(), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("...")).toBe(true);
    expect(out).not.toMatch(/palab\.\.\.$/);
  });

  it("is a no-op for the web channel", () => {
    const md = "**bold** [x](https://a.example)";
    expect(renderForChannel(md, "web")).toBe(md);
  });
});
