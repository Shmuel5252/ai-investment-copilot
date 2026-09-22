import { beforeEach, describe, expect, it, vi } from "vitest";
import { anthropic } from "@/lib/ai/client";
import { proposeObservedPrinciples, extractDeclaredPrinciples } from "@/lib/ai/strategy";
import { proposeDnaHypotheses } from "@/lib/ai/dna";
import { StructuredOutputError } from "@/lib/ai/structured-output";
import {
  validateProposedDeclaredPrinciples,
  validateProposedObservedPrinciples,
} from "@/lib/strategy/validate-principles";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import { resolverFromCaseKeys } from "../helpers/independence";

// The only mock is the network boundary (same convention as
// dna-grounding.test.ts): zero real API calls. Everything under test —
// the three production generators, the shared normalizer they call, and
// the real domain validators run on their output — is the real code.
vi.mock("@/lib/ai/client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: "claude-sonnet-5",
}));

const create = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;

function respondWithToolInput(input: unknown) {
  create.mockResolvedValueOnce({ content: [{ type: "tool_use", input }] });
}

const ANSWERS = [
  { id: "a1", questionText: "q1", answerText: "t1" },
  { id: "a2", questionText: "q2", answerText: "t2" },
];
const CASE_KEYS = new Map([
  ["a1", "case-1"],
  ["a2", "case-2"],
]);
const VALID_IDS = new Set(["a1", "a2"]);

const ev = (id: string, stance: string = "supporting", description = "generic description") => ({
  interviewAnswerId: id,
  stance,
  description,
});

type Key = "principles" | "hypotheses";

interface CallerConfig {
  name: string;
  key: Key;
  label: string;
  noToolUseMessage: string;
  call: (answers: typeof ANSWERS) => Promise<unknown[]>;
  validItem: (n: string) => unknown;
  /** Representation-valid items that the existing domain validator must not accept. */
  domainInvalidItems: unknown[];
  /** One real citation plus one hallucinated citation, in this caller's own item shape. */
  itemWithHallucinatedCitation: unknown;
  citedIdsOf: (validated: unknown) => string[];
  validate: (proposed: unknown[]) => unknown[];
  statementOf: (validated: unknown) => string;
}

const evidenceShapedInvalid: unknown[] = [
  { statement: "   ", evidence: [ev("a1")] },
  { statement: "claim", evidence: [ev("hallucinated-id")] },
  { statement: "claim", evidence: [ev("a1", "maybe")] },
  { statement: "claim", evidence: [ev("a1", "supporting", "")] },
  { statement: "claim", evidence: "not-an-array" },
  { statement: "claim" },
  null,
  5,
  "junk",
];

const CALLERS: CallerConfig[] = [
  {
    name: "Strategy observed — proposeObservedPrinciples",
    key: "principles",
    label: "observed-principles",
    noToolUseMessage: "AI did not return observed principles via the expected tool call.",
    call: (a) => proposeObservedPrinciples(a),
    validItem: (n) => ({ statement: `generic observed claim ${n}`, evidence: [ev("a1"), ev("a2", "contradicting")] }),
    domainInvalidItems: evidenceShapedInvalid,
    itemWithHallucinatedCitation: { statement: "claim", evidence: [ev("a1"), ev("hallucinated-id")] },
    citedIdsOf: (v) => (v as { evidence: { interviewAnswerId: string }[] }).evidence.map((e) => e.interviewAnswerId),
    validate: (p) => validateProposedObservedPrinciples(p as never, resolverFromCaseKeys(CASE_KEYS)),
    statementOf: (v) => (v as { statement: string }).statement,
  },
  {
    name: "Strategy declared — extractDeclaredPrinciples",
    key: "principles",
    label: "declared-principles",
    noToolUseMessage: "AI did not return declared principles via the expected tool call.",
    call: (a) => extractDeclaredPrinciples(a),
    validItem: (n) => ({ statementText: `I follow generic rule ${n}.`, rationaleText: "stated", citedAnswerIds: ["a1"] }),
    domainInvalidItems: [
      { statementText: "", rationaleText: "r", citedAnswerIds: ["a1"] },
      { statementText: "rule", rationaleText: "r", citedAnswerIds: ["hallucinated-id"] },
      { statementText: "rule", rationaleText: 5, citedAnswerIds: ["a1"] },
      { statementText: "rule", rationaleText: "r", citedAnswerIds: "a1" },
      { statementText: "rule", rationaleText: "r" },
      null,
      5,
      "junk",
    ],
    itemWithHallucinatedCitation: { statementText: "rule", rationaleText: "r", citedAnswerIds: ["a1", "hallucinated-id"] },
    citedIdsOf: (v) => (v as { citedAnswerIds: string[] }).citedAnswerIds,
    validate: (p) => validateProposedDeclaredPrinciples(p as never, VALID_IDS),
    statementOf: (v) => (v as { statementText: string }).statementText,
  },
  {
    name: "DNA — proposeDnaHypotheses",
    key: "hypotheses",
    label: "hypotheses",
    noToolUseMessage: "AI did not return hypotheses via the expected tool call.",
    call: (a) => proposeDnaHypotheses(a),
    validItem: (n) => ({ statement: `generic dna claim ${n}`, evidence: [ev("a1"), ev("a2", "contradicting")] }),
    domainInvalidItems: evidenceShapedInvalid,
    itemWithHallucinatedCitation: { statement: "claim", evidence: [ev("a1"), ev("hallucinated-id")] },
    citedIdsOf: (v) => (v as { evidence: { interviewAnswerId: string }[] }).evidence.map((e) => e.interviewAnswerId),
    validate: (p) => validateProposedHypotheses(p as never, resolverFromCaseKeys(CASE_KEYS)),
    statementOf: (v) => (v as { statement: string }).statement,
  },
];

const REJECTS: [string, (key: Key, items: unknown[]) => unknown, string][] = [
  ["prose", () => "Here are your results.", "malformed_json"],
  [
    "a string-wrapped collection with unescaped quotes inside a value (second live incident class)",
    (k) => ({ [k]: `{"${k}":[{"statement":"You tend to "lock in" gains early","evidence":[]}]}` }),
    "malformed_json",
  ],
  ["Markdown-fenced JSON", () => "```json\n[]\n```", "malformed_json"],
  ["a wrong wrapper key", () => ({ wrongKey: [] }), "unexpected_representation"],
  ["a missing key", () => ({}), "unexpected_representation"],
  ["null", () => null, "unexpected_representation"],
  ["a number as the collection field", (k) => ({ [k]: 5 }), "not_an_array"],
  ["an object instead of the array", (k) => ({ [k]: {} }), "not_an_array"],
  ["an ambiguous wrapper", (k) => ({ [k]: [], other: [] }), "unexpected_representation"],
  [
    "encoding beyond the depth bound",
    (k, items) => JSON.stringify({ [k]: JSON.stringify({ [k]: JSON.stringify(items) }) }),
    "depth_exceeded",
  ],
];

describe.each(CALLERS)("$name", (c) => {
  beforeEach(() => {
    create.mockReset();
  });

  const items = [c.validItem("A"), c.validItem("B")];

  describe("representation normalization at the real generator boundary", () => {
    it("direct wrapper: returned exactly as before the hardening", async () => {
      respondWithToolInput({ [c.key]: items });
      await expect(c.call(ANSWERS)).resolves.toEqual(items);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("OBSERVED INCIDENT REGRESSION: collection field is a JSON string wrapping a wrapper of the same key -> normalized, then the normal domain validator proceeds", async () => {
      // Structurally identical to the failed live response: HTTP 200, one
      // tool call, tool input {K: "<JSON string of {K:[...]}>"} — with the
      // multi-line formatting the live string carried. Generic content only.
      const encodedInner = `{"${c.key}": [\n${items.map((i) => JSON.stringify(i)).join(",\n")}\n]}`;
      respondWithToolInput({ [c.key]: encodedInner });

      const proposed = await c.call(ANSWERS);
      expect(proposed).toEqual(items);
      expect(create).toHaveBeenCalledTimes(1);

      // Existing domain validation still runs on the normalized result.
      const validated = c.validate(proposed);
      expect(validated.map(c.statementOf)).toEqual(items.map(c.statementOf));
    });

    it("other deterministic equivalents: string-encoded array, string-encoded wrapper, encoded field", async () => {
      respondWithToolInput(JSON.stringify(items));
      await expect(c.call(ANSWERS)).resolves.toEqual(items);
      respondWithToolInput(JSON.stringify({ [c.key]: items }));
      await expect(c.call(ANSWERS)).resolves.toEqual(items);
      respondWithToolInput({ [c.key]: JSON.stringify(items) });
      await expect(c.call(ANSWERS)).resolves.toEqual(items);
    });

    it("an empty generation (a normal, permitted result) is accepted in every representation", async () => {
      for (const input of [{ [c.key]: [] }, { [c.key]: "[]" }, { [c.key]: JSON.stringify({ [c.key]: [] }) }, "[]"]) {
        respondWithToolInput(input);
        await expect(c.call(ANSWERS)).resolves.toEqual([]);
      }
    });

    it("still throws its pre-existing error when the tool call is missing entirely", async () => {
      create.mockResolvedValueOnce({ content: [{ type: "text", text: "no tool" }] });
      await expect(c.call(ANSWERS)).rejects.toThrow(c.noToolUseMessage);
    });

    it.each(REJECTS)(
      "fails closed on %s (typed error, caller-specific message, exactly one SDK call — no retry)",
      async (_name, buildInput, code) => {
        respondWithToolInput(buildInput(c.key, items));

        const error = await c.call(ANSWERS).then(
          () => null,
          (e: unknown) => e
        );
        expect(error).toBeInstanceOf(StructuredOutputError);
        expect((error as StructuredOutputError).code).toBe(code);
        expect((error as Error).message).toBe(`AI returned a malformed ${c.label} list (${code}).`);
        expect(create).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe("domain validation stays separate and fail-closed after normalization", () => {
    // Semantics (pre-existing, deliberately unchanged): the domain
    // validators EXCLUDE an invalid item and keep the valid ones — they do
    // not throw. That per-item exclusion is the reviewed contract each
    // downstream gate (grounding, identity) is built on; an invalid item
    // never reaches them.
    it("19. a representation-valid but domain-invalid item is accepted by normalization and then rejected by the existing validator", async () => {
      for (const bad of c.domainInvalidItems) {
        respondWithToolInput({ [c.key]: JSON.stringify({ [c.key]: [bad] }) });
        const proposed = await c.call(ANSWERS);
        expect(proposed).toHaveLength(1); // normalization succeeded; nothing judged, nothing repaired
        expect(c.validate(proposed)).toEqual([]); // the domain gate rejected it
      }
    });

    it("20. a mixed array: normalization keeps every element untouched, the validator excludes only the malformed ones, and nothing malformed is repaired into the output", async () => {
      const mixed = [c.validItem("GOOD"), ...c.domainInvalidItems];
      respondWithToolInput({ [c.key]: JSON.stringify({ [c.key]: mixed }) });

      const proposed = await c.call(ANSWERS);
      expect(proposed).toHaveLength(mixed.length); // no partial salvage at the representation layer
      expect(proposed).toEqual(mixed);

      const validated = c.validate(proposed);
      expect(validated.map(c.statementOf)).toEqual([c.statementOf(c.validItem("GOOD"))]);
    });

    it("a normalized payload cannot smuggle a hallucinated citation past the validator", async () => {
      respondWithToolInput({ [c.key]: JSON.stringify({ [c.key]: [c.itemWithHallucinatedCitation] }) });
      const validated = c.validate(await c.call(ANSWERS));
      expect(validated).toHaveLength(1);
      expect(c.citedIdsOf(validated[0])).toEqual(["a1"]);
    });
  });
});
