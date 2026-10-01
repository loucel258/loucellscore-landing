import { describe, it, expect } from "vitest";
import { escapeHtml, subjectSafe, textToEmailHtml } from "@/lib/portal/html";
import { ilikeExactPattern, sameEmail } from "@/lib/portal/email-match";

describe("email HTML", () => {
  it("escapes before adding line breaks", () => {
    const html = textToEmailHtml('Hi <img src=x onerror="alert(1)">\nBye & thanks');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;<br>Bye &amp; thanks");
  });

  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href='x'>"&"</a>`)).toBe("&lt;a href=&#039;x&#039;&gt;&quot;&amp;&quot;&lt;/a&gt;");
  });

  it("strips header-breaking newlines from subjects", () => {
    expect(subjectSafe("Acme\r\nBcc: evil@x.com")).toBe("Acme Bcc: evil@x.com");
  });
});

describe("case-insensitive exact email match", () => {
  it("escapes LIKE wildcards", () => {
    expect(ilikeExactPattern("a_b%c\\d@x.com")).toBe("a\\_b\\%c\\\\d@x.com");
    expect(ilikeExactPattern("a*b@x.com")).toBe("a_b@x.com");
  });

  it("compares ignoring case and surrounding space", () => {
    expect(sameEmail("Ana@Mail.com", "ana@mail.com")).toBe(true);
    expect(sameEmail("anaxb@mail.com", "ana_b@mail.com")).toBe(false);
    expect(sameEmail(null, "a@b.c")).toBe(false);
  });
});
