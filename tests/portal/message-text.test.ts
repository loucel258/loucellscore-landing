import { describe, it, expect } from "vitest";
import { previewText, toPlainText, toSegments } from "@/lib/portal/message-text";

describe("toPlainText", () => {
  it("drops bold, headings, bullets, links and code markers", () => {
    expect(
      toPlainText("## Hola\n- uno\n- *dos* con [el link](https://x.com) y `code`"),
    ).toBe("Hola uno dos con el link y code");
  });

  it("leaves arithmetic and snake_case alone", () => {
    expect(toPlainText("precio 5*3 = 15 y snake_case_name")).toBe(
      "precio 5*3 = 15 y snake_case_name",
    );
  });
});

describe("previewText", () => {
  it("strips markdown before cutting and ends on a word", () => {
    const out = previewText(
      "Perfecto. El **Quote Accelerator** es para contratistas de techos y HVAC que quieren responder cotizaciones en minutos.",
    );
    expect(out).not.toContain("**");
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(91);
    expect(out).toMatch(/^Perfecto\. El Quote Accelerator es para/);
  });

  it("returns short text untouched", () => {
    expect(previewText("Hello")).toBe("Hello");
  });
});

describe("toSegments", () => {
  it("splits bold runs and turns bullets into dots, keeping line breaks", () => {
    expect(toSegments("Hola **Ana**,\n- turno a las **3pm**\n- [ver](http://x)")).toEqual([
      { text: "Hola ", bold: false },
      { text: "Ana", bold: true },
      { text: ",\n• turno a las ", bold: false },
      { text: "3pm", bold: true },
      { text: "\n• ver", bold: false },
    ]);
  });

  it("returns one plain segment when there is no markdown", () => {
    expect(toSegments("just text")).toEqual([{ text: "just text", bold: false }]);
  });
});
