import { describe, it, expect } from "vitest";
import { deriveSlug, slugCandidate, originsFromWebsite, SLUG_BASE_MAX } from "@/lib/admin/slug";

describe("deriveSlug", () => {
  it("lowercases, dashes and drops legal suffixes", () => {
    expect(deriveSlug("Sunset Roofing LLC")).toBe("sunset-roofing");
    expect(deriveSlug("Acme, Inc.")).toBe("acme");
    expect(deriveSlug("Smith & Sons Plumbing Co")).toBe("smith-sons-plumbing");
  });

  it("folds accents and apostrophes", () => {
    expect(deriveSlug("Peluquería Ñandú")).toBe("peluqueria-nandu");
    expect(deriveSlug("Joe's Café")).toBe("joes-cafe");
    expect(deriveSlug("Joe’s Diner")).toBe("joes-diner");
  });

  it("keeps a suffix word when it is the only word", () => {
    expect(deriveSlug("LLC")).toBe("llc");
  });

  it("caps length on whole words", () => {
    const slug = deriveSlug("The Very Long Name Of A Family Owned Roofing And Gutter Company Of Palm Beach");
    expect(slug.length).toBeLessThanOrEqual(SLUG_BASE_MAX);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.startsWith("the-very-long-name")).toBe(true);
  });

  it("always returns a valid address", () => {
    expect(deriveSlug("!!!")).toBe("client");
    expect(deriveSlug("A")).toBe("a-client");
    expect(deriveSlug("x".repeat(80))).toHaveLength(SLUG_BASE_MAX);
    for (const name of ["Sunset Roofing", "日本料理", "A", "Ñ", "  "]) {
      expect(deriveSlug(name)).toMatch(/^[a-z0-9-]{2,64}$/);
    }
  });
});

describe("slugCandidate", () => {
  it("numbers from 2", () => {
    expect(slugCandidate("acme", 0)).toBe("acme");
    expect(slugCandidate("acme", 1)).toBe("acme-2");
    expect(slugCandidate("acme", 2)).toBe("acme-3");
  });
});

describe("originsFromWebsite", () => {
  it("adds https and the www twin for a bare domain", () => {
    expect(originsFromWebsite("sunsetroofing.com/contact")).toEqual([
      "https://sunsetroofing.com",
      "https://www.sunsetroofing.com",
    ]);
  });

  it("adds the apex for a www host", () => {
    expect(originsFromWebsite("https://www.Acme.com")).toEqual(["https://www.acme.com", "https://acme.com"]);
  });

  it("leaves subdomains alone", () => {
    expect(originsFromWebsite("https://book.acme.com")).toEqual(["https://book.acme.com"]);
  });

  it("rejects what is not a usable site", () => {
    expect(originsFromWebsite("")).toEqual([]);
    expect(originsFromWebsite(null)).toEqual([]);
    expect(originsFromWebsite("localhost")).toEqual([]);
    expect(originsFromWebsite("ftp://acme.com")).toEqual([]);
    expect(originsFromWebsite("javascript:alert(1)")).toEqual([]);
    expect(originsFromWebsite("https://user:pw@acme.com")).toEqual([]);
    expect(originsFromWebsite("10.0.0.1")).toEqual([]);
  });
});
