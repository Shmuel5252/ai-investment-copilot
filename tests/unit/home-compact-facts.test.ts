import { describe, expect, it } from "vitest";
import { compactFacts } from "@/components/home/attention-region";

// Frontend V1 unit 2 polish — attention rows show the newest trade fact and a
// count of the rest. Display truncation only: nothing is dropped from the
// data, nothing reordered in place, and the count accounts for every fact.
const fact = (id: string, persistedAt: string) => ({ transactionId: id, persistedAt });

describe("compactFacts", () => {
  it("shows the fact that entered the system last, and counts all the others", () => {
    const facts = [fact("a", "2026-09-01T10:00:00Z"), fact("b", "2026-09-21T10:00:00Z"), fact("c", "2026-09-10T10:00:00Z")];
    const before = JSON.stringify(facts);
    const { first, more } = compactFacts(facts);
    expect(first?.transactionId).toBe("b");
    expect(more).toBe(2);
    // the input list is not reordered or changed
    expect(JSON.stringify(facts)).toBe(before);
  });

  it("a single fact shows no count, and an empty list shows nothing", () => {
    expect(compactFacts([fact("a", "2026-09-01T10:00:00Z")])).toEqual({ first: fact("a", "2026-09-01T10:00:00Z"), more: 0 });
    expect(compactFacts([])).toEqual({ first: undefined, more: 0 });
  });
});
