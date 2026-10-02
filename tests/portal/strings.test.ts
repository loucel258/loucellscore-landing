import { describe, it, expect } from "vitest";
import { portalStringKeys, t, tn } from "@/lib/portal/strings";

describe("portal strings", () => {
  it("defines every key in both languages", () => {
    const en = new Set(portalStringKeys("en"));
    const es = new Set(portalStringKeys("es"));
    expect([...en].filter((k) => !es.has(k))).toEqual([]);
    expect([...es].filter((k) => !en.has(k))).toEqual([]);
  });

  it("every plural key has both .one and .other", () => {
    const keys = new Set(portalStringKeys("en"));
    for (const k of keys) {
      if (k.endsWith(".one")) expect(keys.has(k.replace(/\.one$/, ".other"))).toBe(true);
    }
    const counted = [
      "money.alert_title",
      "home.takeovers",
      "inbox.count",
      "ra.subtitle_pending",
      "customers.count",
      "home.see_all",
      "home.escalations",
      "home.takeovers",
      "customers.conversations",
      "customers.bookings",
    ];
    for (const base of counted) {
      expect(keys.has(`${base}.one`)).toBe(true);
      expect(keys.has(`${base}.other`)).toBe(true);
    }
  });

  it("builds correct Spanish plurals (no suffix gluing)", () => {
    expect(tn("es", "home.takeovers", 3)).toBe("3 conversaciones que estás atendiendo tú");
    expect(tn("es", "home.takeovers", 1)).toBe("1 conversación que estás atendiendo tú");
    expect(tn("es", "ra.subtitle_pending", 2)).toBe("2 acciones esperando tu visto bueno.");
    expect(tn("es", "inbox.count", 5)).toBe("5 conversaciones en los últimos 30 días.");
    expect(tn("es", "money.alert_title", 4)).toBe("4 aprobaciones esperándote");
    expect(tn("en", "money.alert_title", 1)).toBe("1 approval waiting on you");
  });

  it("never glues a plural suffix onto an accented stem", () => {
    for (const lang of ["es", "en"] as const) {
      for (const k of portalStringKeys(lang)) {
        const v = t(lang, k, { n: 2 });
        expect(v).not.toMatch(/ciónes|cións|ientees|\{plural\}/);
      }
    }
  });

  it("uses no em dashes in portal copy", () => {
    for (const lang of ["es", "en"] as const) {
      for (const k of portalStringKeys(lang)) expect(t(lang, k)).not.toContain("—");
    }
  });

  it("never names environment variables in client copy", () => {
    for (const lang of ["es", "en"] as const) {
      for (const k of portalStringKeys(lang)) expect(t(lang, k)).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
    }
  });

  it("has the 5-page nav and the new Spanish plurals", () => {
    for (const k of ["nav.home", "nav.bandeja", "nav.approvals", "nav.customers", "nav.settings"]) {
      expect(t("en", k)).not.toBe(k);
      expect(t("es", k)).not.toBe(k);
    }
    expect(tn("es", "home.escalations", 1)).toBe("1 cliente necesita a una persona");
    expect(tn("es", "home.escalations", 3)).toBe("3 clientes necesitan a una persona");
    expect(tn("es", "customers.bookings", 2)).toBe("2 citas");
    expect(t("es", "inbox.sms_readonly")).toBe("Por ahora responde desde tu teléfono.");
    expect(t("en", "inbox.sms_readonly")).toBe("Reply from your phone for now.");
  });

  it("keeps no copy for retired pages (agents, integrations, analytics, old funnel)", () => {
    const retired = [
      "agents.title",
      "agents.plan",
      "agent.back",
      "agent.decisions_title",
      "integrations.title",
      "analytics.funnel_title",
      "resumen.cta_pending.one",
      "money.clear_title",
      "nav.your_agents",
      "settings.tab_activity",
    ];
    for (const lang of ["en", "es"] as const) {
      const keys = new Set(portalStringKeys(lang));
      expect(retired.filter((k) => keys.has(k))).toEqual([]);
      expect([...keys].filter((k) => k.startsWith("agent.") || k.startsWith("integrations."))).toEqual([]);
    }
  });

  it("uses neutral Spanish (no voseo)", () => {
    for (const k of portalStringKeys("es")) {
      expect(t("es", k)).not.toMatch(/\b(tenés|querés|podés|escribí|respondé|mirá|fijate|vos)\b/i);
    }
  });
});
