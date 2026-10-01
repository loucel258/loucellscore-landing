import { describe, it, expect } from "vitest";
import {
  HOUSE_AGENT_SLUGS,
  readBookingConfig,
  resolveBookingLink,
  safeHttpsUrl,
} from "@/lib/agents/booking-config";
import { handleRequestBooking, REQUEST_BOOKING_TOOL } from "@/lib/chat/tools";
import { siteConfig } from "@/lib/site-config";

/**
 * Cross-tenant booking link (found live: naile-assistant had request_booking
 * enabled and every booking went to Loucells Core's own Cal.com with the
 * salon customer's name + reason in the URL). The link must come from the
 * agent's own config; only Loucells' house agents may fall back to the
 * Loucells Cal.com page.
 */

const BOOKING = { name: "Ana Pérez", email: "ana@example.com", reason: "Gel manicure" };

describe("safeHttpsUrl", () => {
  it("accepts absolute https URLs", () => {
    expect(safeHttpsUrl("https://nailestudio.vercel.app/book")).toBe("https://nailestudio.vercel.app/book");
    expect(safeHttpsUrl("  https://cal.com/x/30min ")).toBe("https://cal.com/x/30min");
  });

  it("rejects http, scripts, relative, credentials, junk", () => {
    for (const bad of [
      "http://example.com/book",
      "javascript:alert(1)",
      "/book",
      "example.com/book",
      "https://user:pass@example.com/book",
      "",
      42,
      null,
      `https://example.com/${"a".repeat(600)}`,
    ]) {
      expect(safeHttpsUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("readBookingConfig", () => {
  it("reads mode, link and prefill from integrations.booking", () => {
    expect(
      readBookingConfig({ booking: { mode: "external", link_url: "https://a.example/b", prefill: true } }),
    ).toEqual({ mode: "external", linkUrl: "https://a.example/b", prefill: true });
  });

  it("is safe on missing / malformed config", () => {
    expect(readBookingConfig(null)).toEqual({ mode: null, linkUrl: null, prefill: false });
    expect(readBookingConfig({ booking: "nope" })).toEqual({ mode: null, linkUrl: null, prefill: false });
    expect(readBookingConfig({ booking: { mode: "remote", link_url: "http://x.example" } })).toEqual({
      mode: null,
      linkUrl: null,
      prefill: false,
    });
  });
});

describe("resolveBookingLink", () => {
  it("client tenant with a configured link uses ITS link", () => {
    const link = resolveBookingLink({
      slug: "naile-assistant",
      integrations: { booking: { link_url: "https://nailestudio.vercel.app/book" } },
    });
    expect(link).toEqual({ url: "https://nailestudio.vercel.app/book", prefill: false, source: "config" });
  });

  it("client tenant WITHOUT a link gets null — never Loucells' Cal.com", () => {
    expect(resolveBookingLink({ slug: "naile-assistant", integrations: {} })).toBeNull();
    expect(resolveBookingLink({ slug: "naile-assistant" })).toBeNull();
    // An http (non-https) link is treated as not configured.
    expect(
      resolveBookingLink({ slug: "naile-assistant", integrations: { booking: { link_url: "http://x.example" } } }),
    ).toBeNull();
  });

  it("house agents fall back to siteConfig.calUrl with prefill (unchanged behavior)", () => {
    for (const slug of HOUSE_AGENT_SLUGS) {
      const link = resolveBookingLink({ slug, integrations: {} });
      expect(link?.url).toBe(new URL(siteConfig.calUrl).href);
      expect(link?.prefill).toBe(true);
      expect(link?.source).toBe("house_fallback");
    }
  });

  it("a house agent's explicit link wins over the fallback", () => {
    const link = resolveBookingLink({
      slug: "loucels-landing",
      integrations: { booking: { link_url: "https://cal.com/other/15min", prefill: true } },
    });
    expect(link).toEqual({ url: "https://cal.com/other/15min", prefill: true, source: "config" });
  });

  it("a slug that merely contains 'loucels-landing' is not a house agent", () => {
    expect(resolveBookingLink({ slug: "loucels-landing-evil", integrations: {} })).toBeNull();
  });
});

describe("handleRequestBooking", () => {
  it("client link without prefill: no visitor data in the URL", () => {
    const { bookingLink } = handleRequestBooking(BOOKING, {
      url: "https://nailestudio.vercel.app/book",
      prefill: false,
    });
    expect(bookingLink).toBe("https://nailestudio.vercel.app/book");
    expect(bookingLink).not.toContain("Ana");
    expect(bookingLink).not.toContain("ana@example.com");
  });

  it("prefill adds name + notes but never the email", () => {
    const { bookingLink, prefilledFor } = handleRequestBooking(
      { ...BOOKING, preferredWindow: "mornings" },
      { url: "https://cal.com/loucellscore/30min", prefill: true },
    );
    const u = new URL(bookingLink);
    expect(u.origin + u.pathname).toBe("https://cal.com/loucellscore/30min");
    expect(u.searchParams.get("name")).toBe("Ana Pérez");
    expect(u.searchParams.get("notes")).toBe("Gel manicure (preferred: mornings)");
    expect(bookingLink).not.toContain("ana%40example.com");
    expect(bookingLink).not.toContain("ana@example.com");
    expect(prefilledFor).toBe("Ana Pérez");
  });

  it("prefill keeps an existing query string intact", () => {
    const { bookingLink } = handleRequestBooking(BOOKING, {
      url: "https://book.example.com/s?location=main",
      prefill: true,
    });
    const u = new URL(bookingLink);
    expect(u.searchParams.get("location")).toBe("main");
    expect(u.searchParams.get("name")).toBe("Ana Pérez");
  });
});

describe("REQUEST_BOOKING_TOOL description", () => {
  it("is tenant-neutral (no Loucells sales copy, no Cal.com)", () => {
    const text = JSON.stringify(REQUEST_BOOKING_TOOL);
    expect(REQUEST_BOOKING_TOOL.description).toMatch(/^Share the business's booking link/);
    expect(text).not.toMatch(/cal\.com/i);
    expect(text).not.toMatch(/Loucells|Steven|dental|clinic|pricing/i);
  });
});
