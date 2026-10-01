import { describe, it, expect } from "vitest";
import {
  parseSmsKeyword,
  isOptOutMessage,
  isOptInMessage,
  normalizeKeyword,
  readSendWindow,
  isQuietHours,
  canSendProactive,
  DEFAULT_SEND_WINDOW,
} from "@/lib/booking/gates";

/**
 * SMS keyword parser (opt-out / opt-in). Carrier keywords stay as they were;
 * REVOKE/OPTOUT and Spanish keywords are new. Only the exact single-word
 * message counts, so "cancelar mi cita" is an appointment request, not an
 * opt-out.
 */

describe("parseSmsKeyword — opt-out", () => {
  it("carrier keywords are flagged as carrier-handled", () => {
    for (const k of ["STOP", "stop", "Stop.", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]) {
      expect(parseSmsKeyword(k), k).toEqual({ kind: "opt_out", keyword: normalizeKeyword(k), carrierHandled: true });
    }
  });

  it("REVOKE / OPTOUT and Spanish keywords opt out (not carrier-handled)", () => {
    for (const k of ["REVOKE", "optout", "PARAR", "parar", "Alto", "ALTO!", "baja", "Baja.", "CANCELAR", "¡Cancelar!"]) {
      const r = parseSmsKeyword(k);
      expect(r?.kind, k).toBe("opt_out");
      expect(r && r.kind === "opt_out" && r.carrierHandled, k).toBe(false);
      expect(isOptOutMessage(k), k).toBe(true);
    }
  });

  it("keywords inside a sentence are NOT opt-outs (ambiguous CANCELAR/CANCEL)", () => {
    for (const msg of [
      "cancelar mi cita",
      "Quiero cancelar",
      "cancel my appointment",
      "please stop by tomorrow",
      "dar de baja la cita",
      "alto ahí, una pregunta",
      "no parar",
    ]) {
      expect(parseSmsKeyword(msg), msg).toBeNull();
      expect(isOptOutMessage(msg), msg).toBe(false);
    }
  });

  it("obfuscated or partial words do not match", () => {
    for (const msg of ["St0p", "STOPP", "BAJAR", "OPT OUT", "cancela"]) {
      expect(parseSmsKeyword(msg), msg).toBeNull();
    }
  });

  it("empty / whitespace / punctuation-only is not a keyword", () => {
    for (const msg of ["", "   ", "!!!", "¿?"]) expect(parseSmsKeyword(msg), JSON.stringify(msg)).toBeNull();
  });
});

describe("parseSmsKeyword — opt-in", () => {
  it("formal opt-in keywords (EN + ES)", () => {
    for (const k of ["YES", "START", "UNSTOP", "SI", "SÍ", "sí", "si", "yes."]) {
      expect(parseSmsKeyword(k)?.kind, k).toBe("opt_in");
      expect(isOptInMessage(k), k).toBe(true);
    }
  });

  it("casual re-consent text is not an opt-in (R07)", () => {
    expect(isOptInMessage("ok sigue mandándome mensajes")).toBe(false);
    expect(isOptInMessage("si, a las 3")).toBe(false);
  });
});

describe("send window (quiet hours) config", () => {
  const TZ = "America/New_York";
  const edt = (hour: number, minute = 0) => new Date(Date.UTC(2026, 6, 10, hour + 4, minute));

  it("defaults to 8am-9pm", () => {
    expect(readSendWindow({})).toEqual(DEFAULT_SEND_WINDOW);
    expect(readSendWindow(null)).toEqual({ startHour: 8, endHour: 21 });
  });

  it("config can narrow the window (e.g. FTSA 8pm)", () => {
    const w = readSendWindow({ quiet_hours: { start_hour: 9, end_hour: 20 } });
    expect(w).toEqual({ startHour: 9, endHour: 20 });
    expect(isQuietHours(TZ, edt(20, 15), w)).toBe(true);
    expect(isQuietHours(TZ, edt(8, 30), w)).toBe(true);
    expect(isQuietHours(TZ, edt(12), w)).toBe(false);
  });

  it("config can never widen past 8am-9pm, and invalid values fall back", () => {
    expect(readSendWindow({ quiet_hours: { start_hour: 6, end_hour: 23 } })).toEqual({ startHour: 8, endHour: 21 });
    expect(readSendWindow({ quiet_hours: { start_hour: 20, end_hour: 9 } })).toEqual(DEFAULT_SEND_WINDOW);
    expect(readSendWindow({ quiet_hours: { start_hour: "9", end_hour: 1.5 } })).toEqual(DEFAULT_SEND_WINDOW);
  });

  it("canSendProactive honors a narrowed window", () => {
    const c = { opted_out: false, consent_transactional: true, consent_marketing: true };
    const w = { startHour: 9, endHour: 20 };
    expect(canSendProactive(c, "transactional", TZ, edt(20, 30), w)).toEqual({ allowed: false, reason: "quiet_hours" });
    expect(canSendProactive(c, "transactional", TZ, edt(20, 30))).toEqual({ allowed: true });
  });
});
