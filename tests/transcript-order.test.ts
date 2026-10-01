import { describe, it, expect } from "vitest";
import { byTurnOrder } from "@/lib/transcript-order";

describe("byTurnOrder", () => {
  it("puts the customer's message before the reply when timestamps tie", () => {
    const at = "2026-06-10T21:35:12.123456+00:00";
    const rows = [
      { role: "assistant", inserted_at: at, text: "reply" },
      { role: "user", inserted_at: at, text: "question" },
    ];
    expect(rows.sort(byTurnOrder).map((r) => r.text)).toEqual(["question", "reply"]);
  });

  it("keeps plain chronological order otherwise", () => {
    const rows = [
      { role: "user", inserted_at: "2026-06-10T21:36:00Z", text: "second" },
      { role: "assistant", inserted_at: "2026-06-10T21:35:00Z", text: "first" },
    ];
    expect(rows.sort(byTurnOrder).map((r) => r.text)).toEqual(["first", "second"]);
  });
});
