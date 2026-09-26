// Grounding Semantics V3.1 — strict grounding tool + technical-failure
// semantics. Root cause of the supervised V3 run's call #12: the grounding
// tool was sent WITHOUT `strict: true`, so its enum was advisory and the model
// returned "contradicting". This file pins: the tool is strict at the API
// boundary (schema strict-compliant, enum, required verdict+reason, no extra
// properties, forced tool selection); the parser stays fail-closed as
// defense in depth and labels every malformed result a TECHNICAL failure;
// every consumer treats a technical failure as "not evidence" and the
// remediation planners refuse to write anything from it. Mocked client only.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: "claude-sonnet-5",
}));

import { anthropic } from "@/lib/ai/client";
import { GROUNDING_TOOL, GROUNDING_TOOL_NAME, checkEvidenceGrounding, parseGroundingResponse, type EvidenceGroundingCheckInput } from "@/lib/ai/dna-grounding";
import { groundValidatedHypotheses } from "@/lib/dna/ground-evidence";
import { groundValidatedObservedPrinciples } from "@/lib/strategy/ground-evidence";
import { groundCarryCitations } from "@/lib/learning/carry-to-dna";
import { planGroundingRemediation } from "@/lib/dna/remediate-grounding";
import { planPrincipleGroundingRemediation } from "@/lib/strategy/remediate-grounding";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import { validateProposedObservedPrinciples } from "@/lib/strategy/validate-principles";
import { createIndependenceResolver } from "@/lib/evidence/resolve-independence";
import type { DecisionStatement } from "@/lib/evidence/decision-statements";
import { contextFromTrades } from "../helpers/independence";

const create = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;

// The exact malformed tool input the supervised V3 run's call #12 produced.
const CALL_12_INPUT = {
  verdict: "contradicting",
  reason: "The investor explicitly says they sold to lock in profit because they expected a correction after such a large rise and doubted the stock could keep climbing, showing a decision driven by anticipated price reversal rather than continued belief in the company's story.",
};

// Strict-mode requirements as the production strict test states them.
const ALLOWED_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "items", "description", "enum"]);
function strictViolations(schema: Record<string, unknown>, path = "$"): string[] {
  const out: string[] = [];
  for (const k of Object.keys(schema)) if (!ALLOWED_KEYWORDS.has(k)) out.push(`${path}: keyword ${k}`);
  if (schema.type === "object") {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    if (schema.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
    if (JSON.stringify([...(schema.required as string[])].sort()) !== JSON.stringify(Object.keys(props).sort())) out.push(`${path}: required must list every property`);
    for (const [n, c] of Object.entries(props)) out.push(...strictViolations(c, `${path}.${n}`));
  }
  return out;
}

describe("strict grounding tool at the API boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the tool is strict, enum-constrained, requires verdict and reason, forbids extra properties, and is strict-mode compliant", () => {
    expect(GROUNDING_TOOL.name).toBe(GROUNDING_TOOL_NAME);
    expect(GROUNDING_TOOL.strict).toBe(true);
    expect(GROUNDING_TOOL.input_schema.additionalProperties).toBe(false);
    expect([...GROUNDING_TOOL.input_schema.required].sort()).toEqual(["reason", "verdict"]);
    expect(GROUNDING_TOOL.input_schema.properties.verdict.enum).toEqual(["supported", "unsupported"]);
    expect(strictViolations(GROUNDING_TOOL.input_schema as unknown as Record<string, unknown>)).toEqual([]);
  });

  it("the real request sends exactly that strict tool with forced tool selection", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: GROUNDING_TOOL_NAME, input: { verdict: "supported", reason: "r" } }] });
    await checkEvidenceGrounding({ hypothesisStatement: "claim", stance: "supporting", sourceAnswerText: "text" });
    const call = create.mock.calls[0]![0];
    expect(call.tools).toEqual([GROUNDING_TOOL]);
    expect(call.tools[0].strict).toBe(true);
    expect(call.tool_choice).toEqual({ type: "tool", name: GROUNDING_TOOL_NAME });
  });
});

describe("parser defense in depth: every malformed result is a TECHNICAL failure, never a semantic verdict", () => {
  const ok = (v: "supported" | "unsupported") => ({ type: "tool_use", name: GROUNDING_TOOL_NAME, input: { verdict: v, reason: "r" } });
  it("supported and unsupported are accepted as semantic verdicts (no technical flag)", () => {
    expect(parseGroundingResponse(ok("supported"))).toEqual({ verdict: "supported", reason: "r" });
    expect(parseGroundingResponse(ok("unsupported"))).toEqual({ verdict: "unsupported", reason: "r" });
  });
  it("the exact call #12 result ('contradicting') is rejected as technical, not mapped to a semantic unsupported", () => {
    const r = parseGroundingResponse({ type: "tool_use", name: GROUNDING_TOOL_NAME, input: CALL_12_INPUT });
    expect(r).toEqual({ verdict: "unsupported", reason: "Grounding check returned a malformed verdict — failing closed.", technicalFailure: true });
    expect(r.reason).not.toContain(CALL_12_INPUT.reason.slice(0, 20)); // the model's prose never becomes the recorded reason
  });
  it("missing verdict, missing reason, extra-only input, non-object input, wrong tool, free text and no block are all technical", () => {
    for (const bad of [
      { type: "tool_use", name: GROUNDING_TOOL_NAME, input: { reason: "r" } },
      { type: "tool_use", name: GROUNDING_TOOL_NAME, input: { verdict: "supported" } },
      { type: "tool_use", name: GROUNDING_TOOL_NAME, input: { extra: true } },
      { type: "tool_use", name: GROUNDING_TOOL_NAME, input: "supported" },
      { type: "tool_use", name: GROUNDING_TOOL_NAME, input: null },
      { type: "tool_use", name: "record_match_verdict", input: { verdict: "supported", reason: "r" } },
      { type: "text", text: "supported" },
      undefined,
    ]) {
      const r = parseGroundingResponse(bad as never);
      expect(r.verdict).toBe("unsupported");
      expect(r.technicalFailure).toBe(true);
    }
  });
  it("a well-formed result with an unexpected extra property is still accepted (the strict schema forbids it at the boundary; the parser only needs verdict + reason)", () => {
    expect(parseGroundingResponse({ type: "tool_use", name: GROUNDING_TOOL_NAME, input: { verdict: "supported", reason: "r", note: "x" } })).toEqual({ verdict: "supported", reason: "r" });
  });
});

describe("checkEvidenceGrounding (mocked client): transport and shape failures are technical", () => {
  beforeEach(() => vi.clearAllMocks());
  it("API rejection -> technical; text-only response -> technical; wrong tool -> technical; well-formed -> semantic", async () => {
    const input: EvidenceGroundingCheckInput = { hypothesisStatement: "claim", stance: "contradicting", sourceAnswerText: "text" };
    create.mockRejectedValueOnce(new Error("rate limited"));
    expect(await checkEvidenceGrounding(input)).toMatchObject({ verdict: "unsupported", technicalFailure: true });
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "unsupported" }] });
    expect(await checkEvidenceGrounding(input)).toMatchObject({ verdict: "unsupported", technicalFailure: true });
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "record_match_verdict", input: { verdict: "supported", reason: "r" } }] });
    expect(await checkEvidenceGrounding(input)).toMatchObject({ verdict: "unsupported", technicalFailure: true });
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: GROUNDING_TOOL_NAME, input: CALL_12_INPUT }] });
    expect(await checkEvidenceGrounding(input)).toMatchObject({ verdict: "unsupported", technicalFailure: true });
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: GROUNDING_TOOL_NAME, input: { verdict: "supported", reason: "affirmative" } }] });
    expect(await checkEvidenceGrounding(input)).toEqual({ verdict: "supported", reason: "affirmative" });
  });
});

// ---- consumers ---------------------------------------------------------
const resolver = createIndependenceResolver({ ...contextFromTrades([], [{ id: "a1", txn: null, text: "answer one" }, { id: "a2", txn: null, text: "answer two" }]), decisions: [{ id: "d1", caseResolution: { kind: "own" } }] });
const TEXTS = new Map([["a1", "answer one"], ["a2", "answer two"], ["decision:d1:reasoning", "decision text"]]);
const technicalGate = async (): ReturnType<typeof checkEvidenceGrounding> => parseGroundingResponse({ type: "tool_use", name: GROUNDING_TOOL_NAME, input: CALL_12_INPUT });
const throwingGate = async (): ReturnType<typeof checkEvidenceGrounding> => { throw new Error("network"); };

describe("generation gates: a technical failure is excluded and reported as technical, never counted", () => {
  it("DNA and Strategy grounding filters", async () => {
    const proposed = [{ statement: "claim", evidence: [{ statementId: "a1", stance: "supporting" as const, description: "d" }, { statementId: "a2", stance: "contradicting" as const, description: "d" }] }];
    const dna = await groundValidatedHypotheses(validateProposedHypotheses(proposed, resolver), TEXTS, resolver, technicalGate);
    expect(dna.hypotheses).toEqual([]);
    expect(dna.excluded.every((e) => e.technicalFailure === true)).toBe(true);
    const thrown = await groundValidatedHypotheses(validateProposedHypotheses(proposed, resolver), TEXTS, resolver, throwingGate);
    expect(thrown.excluded.every((e) => e.technicalFailure === true)).toBe(true);
    const strat = await groundValidatedObservedPrinciples(validateProposedObservedPrinciples(proposed, resolver), TEXTS, resolver, technicalGate);
    expect(strat.principles).toEqual([]);
    expect(strat.excluded.every((e) => e.technicalFailure === true)).toBe(true);
  });
  it("Learning carry", async () => {
    const stmt: DecisionStatement = { statementId: "decision:d1:reasoning", decisionId: "d1", kind: "reasoning", ticker: "X", decisionType: "BUY", decisionDate: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z"), text: "decision text" };
    const out = await groundCarryCitations("claim", [{ decisionId: "d1", stance: "contradicting" }], [stmt], technicalGate);
    expect(out.citations).toEqual([]);
    expect(out.excluded).toEqual([{ decisionId: "d1", kind: "reasoning", stance: "contradicting", reason: expect.stringContaining("malformed"), technicalFailure: true }]);
  });
});

describe("remediation planners: a technical failure produces NO plan to write (no version, no check row)", () => {
  const raw = [
    { id: "ev-1", interviewAnswerId: "a1", stance: "supporting" as const },
    { id: "ev-2", interviewAnswerId: null, decisionStatement: { decisionId: "d1", kind: "reasoning" as const }, stance: "contradicting" as const },
  ];
  const mixedGate = async (i: EvidenceGroundingCheckInput): ReturnType<typeof checkEvidenceGrounding> => (i.stance === "contradicting" ? technicalGate() : { verdict: "supported", reason: "ok" });
  it("DNA planner stops at the technical failure, naming the evidence row", async () => {
    const plan = await planGroundingRemediation({ currentVersion: { id: "v1", statementText: "claim" }, rawEvidence: raw, answerTextById: TEXTS, independence: resolver, alreadyGroundedEvidenceIds: null }, mixedGate);
    expect(plan).toEqual({ action: "technical_failure", failures: [{ evidenceId: "ev-2", reason: "Grounding check returned a malformed verdict — failing closed." }] });
  });
  it("Strategy planner stops at the technical failure, naming the evidence row", async () => {
    const plan = await planPrincipleGroundingRemediation({ currentVersion: { id: "v1", statementText: "claim", principleType: "observed" }, rawEvidence: raw, answerTextById: TEXTS, independence: resolver, alreadyGroundedEvidenceIds: null }, mixedGate);
    expect(plan).toEqual({ action: "technical_failure", failures: [{ evidenceId: "ev-2", reason: "Grounding check returned a malformed verdict — failing closed." }] });
  });
  it("a SEMANTIC unsupported (well-formed) still plans normally: contrast with the technical case", async () => {
    const semanticGate = async (i: EvidenceGroundingCheckInput): ReturnType<typeof checkEvidenceGrounding> => ({ verdict: i.stance === "contradicting" ? "unsupported" : "supported", reason: "judged" });
    const plan = await planGroundingRemediation({ currentVersion: { id: "v1", statementText: "claim" }, rawEvidence: raw, answerTextById: TEXTS, independence: resolver, alreadyGroundedEvidenceIds: null }, semanticGate);
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect(plan.checks.map((c) => [c.evidenceId, c.verdict])).toEqual([["ev-1", "supported"], ["ev-2", "unsupported"]]);
    expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount]).toEqual([1, 0]);
  });
});
