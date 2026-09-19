import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeStructuredCollection,
  StructuredOutputError,
  type StructuredOutputErrorCode,
} from "@/lib/ai/structured-output";

// Every case here exercises the real production helper — no parser is
// reimplemented in the test. Fixtures are deliberately generic (no real
// investor content). The helper answers one question only — "can this be
// decoded into the expected array container?" — so items are opaque here:
// their domain validity is the callers' validators' job (see
// ai-structured-output-callers.test.ts).
const ITEMS = [
  { statement: "generic claim one", evidence: [{ interviewAnswerId: "a1", stance: "supporting", description: "d1" }] },
  { statement: "generic claim two", evidence: [{ interviewAnswerId: "a2", stance: "contradicting", description: "d2" }] },
];

function codeOf(fn: () => unknown): StructuredOutputErrorCode {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(StructuredOutputError);
    return (e as StructuredOutputError).code;
  }
  throw new Error("expected the call to throw, but it returned");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(["principles", "hypotheses"])("normalizeStructuredCollection — expected key %s", (K) => {
  const norm = (raw: unknown) => normalizeStructuredCollection(raw, K, "test-items");

  describe("ACCEPT — deterministic equivalents of the collection", () => {
    it("1. direct array", () => {
      expect(norm(ITEMS)).toBe(ITEMS);
    });

    it("2. direct wrapper object", () => {
      expect(norm({ [K]: ITEMS })).toEqual(ITEMS);
    });

    it("3. JSON string containing a direct array", () => {
      expect(norm(JSON.stringify(ITEMS))).toEqual(ITEMS);
    });

    it("4. JSON string containing a wrapper object", () => {
      expect(norm(JSON.stringify({ [K]: ITEMS }))).toEqual(ITEMS);
    });

    it("5. wrapper whose expected field is a JSON-encoded array", () => {
      expect(norm({ [K]: JSON.stringify(ITEMS) })).toEqual(ITEMS);
    });

    it("6. the exact structural class of the observed production incident: wrapper whose expected field is a JSON string holding a wrapper of the same key", () => {
      // Includes the newline/space formatting the live string carried.
      const encodedInner = `{"${K}": [\n${ITEMS.map((i) => JSON.stringify(i)).join(",\n")}\n]}`;
      expect(norm({ [K]: encodedInner })).toEqual(ITEMS);
    });

    it("6b. the deepest accepted chain: string -> wrapper -> encoded field -> wrapper -> array", () => {
      // string -> {K: "<string>"} -> ... exactly two decodes, two unwraps.
      const raw = JSON.stringify({ [K]: JSON.stringify({ [K]: ITEMS }) });
      const spy = vi.spyOn(JSON, "parse");
      expect(norm(raw)).toEqual(ITEMS);
      expect(spy.mock.calls.length).toBe(2);
    });

    it("7. empty array, in every accepted representation", () => {
      expect(norm([])).toEqual([]);
      expect(norm({ [K]: [] })).toEqual([]);
      expect(norm("[]")).toEqual([]);
      expect(norm(JSON.stringify({ [K]: [] }))).toEqual([]);
      expect(norm({ [K]: "[]" })).toEqual([]);
      expect(norm({ [K]: JSON.stringify({ [K]: [] }) })).toEqual([]);
    });

    it("keeps accepting a wrapper carrying extra NON-collection fields (unchanged pre-hardening behavior)", () => {
      expect(norm({ [K]: ITEMS, note: "ignored", n: 3, flag: true, nothing: null })).toEqual(ITEMS);
    });
  });

  describe("REJECT — fail closed", () => {
    it("8. invalid JSON string (outer and field level)", () => {
      expect(codeOf(() => norm("{not json"))).toBe("malformed_json");
      expect(codeOf(() => norm({ [K]: "[{broken" }))).toBe("malformed_json");
    });

    it("8b. SECOND LIVE INCIDENT CLASS: a string-wrapped collection whose JSON is invalid because a value contains unescaped ASCII quotes fails closed (no quote repair)", () => {
      // Generic stand-in: the model used raw " as quotation marks inside a value.
      const invalid = `{"${K}":[{"statement":"You tend to "lock in" gains early","evidence":[]}]}`;
      expect(codeOf(() => norm({ [K]: invalid }))).toBe("malformed_json");
      expect(codeOf(() => norm(invalid))).toBe("malformed_json");
    });

    it("9. natural-language prose, including prose that merely CONTAINS valid JSON and Markdown-fenced JSON (no extraction, no fence stripping)", () => {
      expect(codeOf(() => norm("Here are the results you asked for."))).toBe("malformed_json");
      expect(codeOf(() => norm(`Sure! ${JSON.stringify({ [K]: ITEMS })} Hope that helps.`))).toBe("malformed_json");
      expect(codeOf(() => norm("```json\n" + JSON.stringify(ITEMS) + "\n```"))).toBe("malformed_json");
      expect(codeOf(() => norm({ [K]: "```json\n" + JSON.stringify(ITEMS) + "\n```" }))).toBe("malformed_json");
    });

    it("10. wrong wrapper key (never adopts a different array field)", () => {
      expect(codeOf(() => norm({ items: ITEMS }))).toBe("unexpected_representation");
      expect(codeOf(() => norm(JSON.stringify({ items: ITEMS })))).toBe("unexpected_representation");
      expect(codeOf(() => norm({ [K]: JSON.stringify({ items: ITEMS }) }))).toBe("not_an_array");
    });

    it("11. missing key", () => {
      expect(codeOf(() => norm({}))).toBe("unexpected_representation");
      expect(codeOf(() => norm({ note: "only scalars" }))).toBe("unexpected_representation");
    });

    it("12. null", () => {
      expect(codeOf(() => norm(null))).toBe("unexpected_representation");
      expect(codeOf(() => norm(undefined))).toBe("unexpected_representation");
      expect(codeOf(() => norm({ [K]: null }))).toBe("not_an_array");
      expect(codeOf(() => norm("null"))).toBe("unexpected_representation");
    });

    it("13. boolean", () => {
      expect(codeOf(() => norm(true))).toBe("unexpected_representation");
      expect(codeOf(() => norm({ [K]: false }))).toBe("not_an_array");
      expect(codeOf(() => norm("true"))).toBe("unexpected_representation");
    });

    it("14. number", () => {
      expect(codeOf(() => norm(42))).toBe("unexpected_representation");
      expect(codeOf(() => norm({ [K]: 42 }))).toBe("not_an_array");
      expect(codeOf(() => norm("42"))).toBe("unexpected_representation");
    });

    it("15. an object where the final array is required (a lone item is never coerced into a one-element array)", () => {
      expect(codeOf(() => norm({ [K]: ITEMS[0] }))).toBe("not_an_array");
      expect(codeOf(() => norm({ [K]: JSON.stringify(ITEMS[0]) }))).toBe("not_an_array");
      // A directly nested object wrapper (no string layer) was never observed and is not accepted.
      expect(codeOf(() => norm({ [K]: { [K]: ITEMS } }))).toBe("not_an_array");
    });

    it("16. nested encoding beyond the explicit depth bound", () => {
      // Two wrappers deep in string form = a third decode would be needed.
      const tooDeep = JSON.stringify({ [K]: JSON.stringify({ [K]: JSON.stringify(ITEMS) }) });
      expect(codeOf(() => norm(tooDeep))).toBe("depth_exceeded");
      // A string that decodes to another string.
      expect(codeOf(() => norm(JSON.stringify(JSON.stringify(ITEMS))))).toBe("depth_exceeded");
      expect(codeOf(() => norm({ [K]: JSON.stringify(JSON.stringify(ITEMS)) }))).toBe("depth_exceeded");
      // Same, at the object-in-object-in-string boundary of the incident shape.
      expect(codeOf(() => norm({ [K]: JSON.stringify({ [K]: JSON.stringify(ITEMS) }) }))).toBe("depth_exceeded");
    });

    it("16b. pathological nesting is bounded: never more than TWO JSON.parse calls per normalization, and no recursion", () => {
      // Each extra JSON.stringify layer doubles the escaping, so the
      // string layers themselves can only be built modestly deep; 10 is
      // already 5x past the bound of 2.
      let deep = JSON.stringify(ITEMS);
      for (let i = 0; i < 10; i++) deep = JSON.stringify(deep);

      const spy = vi.spyOn(JSON, "parse");
      expect(codeOf(() => norm(deep))).toBe("depth_exceeded");
      expect(codeOf(() => norm({ [K]: deep }))).toBe("depth_exceeded");
      // One decode per call: the first decode already yields another string.
      expect(spy.mock.calls.length).toBe(2);

      // Deeply nested plain objects are never walked either.
      let obj: unknown = ITEMS;
      for (let i = 0; i < 5000; i++) obj = { [K]: obj };
      expect(codeOf(() => norm({ [K]: obj }))).toBe("not_an_array");
    });

    it("17. ambiguous wrapper: the expected key alongside another possible collection field", () => {
      expect(codeOf(() => norm({ [K]: ITEMS, other: ITEMS }))).toBe("unexpected_representation");
      expect(codeOf(() => norm(JSON.stringify({ [K]: ITEMS, other: [] })))).toBe("unexpected_representation");
      // Ambiguity inside the inner (decoded) wrapper too.
      expect(codeOf(() => norm({ [K]: JSON.stringify({ [K]: ITEMS, other: ITEMS }) }))).toBe("not_an_array");
    });

    it("18. the expected field decodes to the wrong wrapper/key", () => {
      expect(codeOf(() => norm({ [K]: JSON.stringify({ somethingElse: ITEMS }) }))).toBe("not_an_array");
      expect(codeOf(() => norm({ [K]: JSON.stringify({}) }))).toBe("not_an_array");
      expect(codeOf(() => norm({ [K]: JSON.stringify({ [K]: 7 }) }))).toBe("not_an_array");
      expect(codeOf(() => norm({ [K]: JSON.stringify(7) }))).toBe("not_an_array");
    });
  });

  describe("purity — no repair, no salvage, no mutation", () => {
    it("20a. never inspects, repairs, or drops elements: a mixed array is returned exactly as decoded", () => {
      const mixed = [ITEMS[0], null, 5, "junk", { statement: 3 }, ITEMS[1]];
      expect(norm(mixed)).toBe(mixed);
      expect(norm({ [K]: JSON.stringify(mixed) })).toEqual(mixed);
      expect(norm({ [K]: JSON.stringify(mixed) })).toHaveLength(mixed.length);
    });

    it("does not mutate its input", () => {
      const raw = { [K]: JSON.stringify({ [K]: ITEMS }), note: "x" };
      const snapshot = JSON.stringify(raw);
      norm(raw);
      expect(JSON.stringify(raw)).toBe(snapshot);
    });
  });
});

describe("StructuredOutputError — diagnosable without leaking content", () => {
  it("carries a code and the caller's static label only — never the raw value or JSON.parse's quoted snippet", () => {
    const secret = "CONFIDENTIAL-INVESTOR-TEXT-XYZ";
    for (const raw of [
      `not json ${secret}`,
      { principles: `{oops ${secret}` },
      { other: secret },
      secret,
      JSON.stringify({ principles: JSON.stringify({ principles: JSON.stringify([secret]) }) }),
    ]) {
      try {
        normalizeStructuredCollection(raw, "principles", "observed-principles");
        throw new Error("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(StructuredOutputError);
        const err = e as StructuredOutputError;
        expect(err.message).toMatch(/^AI returned a malformed observed-principles list \((malformed_json|unexpected_representation|not_an_array|depth_exceeded)\)\.$/);
        expect(err.message).not.toContain(secret);
        expect(String(err.stack)).not.toContain(secret);
        expect((err as { cause?: unknown }).cause).toBeUndefined();
      }
    }
  });
});
