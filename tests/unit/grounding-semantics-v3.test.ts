// Grounding Semantics V3 (Owner decision frozen 2026-09-25): CONTRADICTION
// REQUIRES AFFIRMATIVE EVIDENCE. This file pins (1) the contract ids, (2) the
// exact rule text every proposer and the grounding gate send, and (3) what the
// REAL pipeline — validateProposed* -> groundValidated* -> the shared
// independence resolver -> the threshold table — does with each verdict, for
// DNA, observed Strategy and the Learning -> DNA carry.
//
// No model is called. The SDK client is mocked for prompt capture only. The
// pipeline fixtures use a REFERENCE GATE: a lookup table that encodes the
// frozen rule for generic fixture texts (statement A..E of the Owner's attack
// cases plus the edge cases). It stands in for the model's judgment so the
// tests prove the code's consequences of each verdict (S, C, exclusion,
// stance never flipped) — not what a live model would answer, which is a
// separate, supervised, live question.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: "claude-sonnet-5",
}));

import { anthropic } from "@/lib/ai/client";
import { AI_CONTRACTS } from "@/lib/ai/contracts";
import { AFFIRMATIVE_STANCE_RULES, STANCE_SEMANTICS_VERSION } from "@/lib/ai/stance-rules";
import { checkEvidenceGrounding, type EvidenceGroundingCheckInput, type EvidenceGroundingResult } from "@/lib/ai/dna-grounding";
import { proposeDnaHypotheses } from "@/lib/ai/dna";
import { proposeObservedPrinciples } from "@/lib/ai/strategy";
import { buildInvestorStatements } from "@/lib/ai/investor-statements";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import { groundValidatedHypotheses } from "@/lib/dna/ground-evidence";
import { validateProposedObservedPrinciples } from "@/lib/strategy/validate-principles";
import { groundValidatedObservedPrinciples } from "@/lib/strategy/ground-evidence";
import { groundCarryCitations } from "@/lib/learning/carry-to-dna";
import type { DecisionStatement } from "@/lib/evidence/decision-statements";
import { assessCitations, createIndependenceResolver } from "@/lib/evidence/resolve-independence";
import { calculateEvidenceStrength } from "@/lib/dna/evidence-strength";
import { buildProvenance } from "@/lib/evidence/provenance";
import { contextFromTrades } from "../helpers/independence";

const create = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;
type Stance = "supporting" | "contradicting";
type Verdict = "supported" | "unsupported";

const CLAIM = "You tend to consider valuation before buying.";

// Generic fixture texts — the Owner's attack cases A..E plus edge cases.
const T = {
  A: "I bought because valuation looked attractive.",
  B: "I bought because I liked the company.",
  C: "Valuation did not matter to me; I bought regardless of price.",
  D: "I bought after a large rise.",
  E: "I knew it was expensive but momentum mattered more.",
  VAGUE: "It felt right at the time.",
  UNCERTAIN: "I don't remember whether I looked at the price.",
  IRRELEVANT: "I will sell if the thesis breaks.",
  PARTIAL_REASONING: "I believe in the sector and want to add to my position.",
  RISKS: "The main risk is the price: it trades near its high, so I am starting with a small position.",
  EXIT: "I will reassess if growth slows for two quarters.",
  MIXED: "I checked the P/E and it was high, but I bought anyway because momentum mattered more.",
} as const;

const NEITHER = { supporting: "unsupported", contradicting: "unsupported" } as const;
/** The frozen rule applied to each fixture, per proposed stance: "supported" = affirmative evidence for THAT stance. */
const V3_REFERENCE: Record<string, { supporting: Verdict; contradicting: Verdict }> = {
  [T.A]: { supporting: "supported", contradicting: "unsupported" },
  [T.B]: NEITHER, // liking the company says nothing about valuation — omission is not the opposite
  [T.C]: { supporting: "unsupported", contradicting: "supported" }, // affirmative disregard of price
  [T.D]: NEITHER, // a different action; nothing says price was ignored
  [T.E]: { supporting: "unsupported", contradicting: "supported" }, // knew it was expensive, bought anyway
  [T.VAGUE]: NEITHER,
  [T.UNCERTAIN]: NEITHER,
  [T.IRRELEVANT]: NEITHER,
  [T.PARTIAL_REASONING]: NEITHER, // the AVGO shape: a partial record silent about price
  [T.RISKS]: { supporting: "supported", contradicting: "unsupported" }, // price weighed, sized smaller
  [T.EXIT]: NEITHER,
  [T.MIXED]: { supporting: "supported", contradicting: "supported" }, // both clauses are affirmative
};

function referenceGate(log: EvidenceGroundingCheckInput[]) {
  return async (input: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> => {
    log.push(input);
    const row = V3_REFERENCE[input.sourceAnswerText];
    if (!row) throw new Error(`no reference verdict for fixture text: ${input.sourceAnswerText}`);
    return { verdict: row[input.stance], reason: `reference ${STANCE_SEMANTICS_VERSION}: ${row[input.stance]} as ${input.stance}` };
  };
}

// One decision per fixture text (own case), plus a decision with several
// statements, a decision with a mixed statement, and an UNRESOLVED decision.
const D = { A: "d-a", B: "d-b", C: "d-c", D: "d-d", E: "d-e", VAGUE: "d-vague", UNCERTAIN: "d-uncertain", IRRELEVANT: "d-irrelevant", PARTIAL: "d-partial", MULTI: "d-multi", MIXED: "d-mixed", UNRESOLVED: "d-unresolved" } as const;
const sid = (decisionId: string, kind: "reasoning" | "risks" | "exit_conditions" = "reasoning") => `decision:${decisionId}:${kind}`;
const TEXT_BY_ID = new Map<string, string>([
  [sid(D.A), T.A], [sid(D.B), T.B], [sid(D.C), T.C], [sid(D.D), T.D], [sid(D.E), T.E],
  [sid(D.VAGUE), T.VAGUE], [sid(D.UNCERTAIN), T.UNCERTAIN], [sid(D.IRRELEVANT), T.IRRELEVANT], [sid(D.PARTIAL), T.PARTIAL_REASONING],
  [sid(D.MULTI, "reasoning"), T.A], [sid(D.MULTI, "risks"), T.RISKS], [sid(D.MULTI, "exit_conditions"), T.EXIT],
  [sid(D.MIXED), T.MIXED],
  [sid(D.UNRESOLVED), T.C],
  ["ans-a", T.A], ["ans-b", T.B],
]);
const context = {
  ...contextFromTrades([], [{ id: "ans-a", txn: null, text: T.A }, { id: "ans-b", txn: null, text: T.B }]),
  decisions: [
    ...Object.values(D).filter((id) => id !== D.UNRESOLVED).map((id) => ({ id, caseResolution: { kind: "own" as const } })),
    { id: D.UNRESOLVED, caseResolution: { kind: "unresolved" as const, candidateTransactionIds: ["t-x"] } },
  ],
};
const resolver = createIndependenceResolver(context);
const cite = (statementId: string, stance: Stance) => ({ statementId, stance, description: `cites ${statementId}` });

async function runDna(cites: ReturnType<typeof cite>[], log: EvidenceGroundingCheckInput[] = []) {
  const validated = validateProposedHypotheses([{ statement: CLAIM, evidence: cites }], resolver);
  return groundValidatedHypotheses(validated, TEXT_BY_ID, resolver, referenceGate(log));
}
async function runStrategy(cites: ReturnType<typeof cite>[], log: EvidenceGroundingCheckInput[] = []) {
  const validated = validateProposedObservedPrinciples([{ statement: CLAIM, evidence: cites }], resolver);
  return groundValidatedObservedPrinciples(validated, TEXT_BY_ID, resolver, referenceGate(log));
}
const countsOf = (h: { supportingCount: number; contradictingCount: number; evidenceStrength: string } | undefined) =>
  h ? { S: h.supportingCount, C: h.contradictingCount, tier: h.evidenceStrength } : null;

describe("contract ids", () => {
  it("bumps the three contracts whose meaning changed and keeps identity/learning untouched", () => {
    expect(AI_CONTRACTS).toEqual({
      dnaPropose: "dna-propose-v3-statements",
      strategyObserve: "strategy-observe-v3-statements",
      evidenceGrounding: "evidence-grounding-v3-statements",
      hypothesisIdentity: "hypothesis-identity-v1",
      learningPropose: "learning-propose-v1",
    });
    expect(STANCE_SEMANTICS_VERSION).toBe("grounding-semantics-v3");
  });

  it("the shared rule text states the frozen semantics once", () => {
    for (const phrase of [
      "SUPPORTING: the statement's own words affirmatively establish",
      "CONTRADICTING: the statement's own words affirmatively establish",
      "NEITHER: the text establishes neither direction",
      "silence; omission; a missing mention; ambiguity; insufficient detail; explicit uncertainty",
      "a different action, unless the investor's own words establish that the action was taken in disregard of the claimed principle",
      "Absence of mention is not evidence of absence",
      "PARTIAL RECORD",
      "Do not infer decision-process facts the text does not record",
      "never read or restate it as \"you always...\"",
      "One instance that does not mention the behavior does not falsify a tendency",
      "Unsupported is not contradiction",
    ]) expect(AFFIRMATIVE_STANCE_RULES).toContain(phrase);
  });
});

describe("grounding gate contract (mocked client, prompt capture only)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the shared rule, the affirmative-contradiction requirement, the partial-record and tendency rules, and the no-flip rule", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", input: { verdict: "unsupported", reason: "r" } }] });
    await checkEvidenceGrounding({ hypothesisStatement: CLAIM, stance: "contradicting", sourceKind: "decision_statement", sourceAnswerText: T.PARTIAL_REASONING });
    const call = create.mock.calls[0]![0];
    expect(call.system).toContain(AFFIRMATIVE_STANCE_RULES);
    for (const re of [
      /affirmatively establishes the opposite or a clearly inconsistent belief\/action/,
      /Absence of mention is not evidence of absence/,
      /A decision statement is a partial record/,
      /do not infer decision-process facts it does not record/,
      /Do not transform a tendency claim/,
      /insufficient affirmative evidence for the claimed stance, return unsupported/,
      /a stance is never flipped/,
      // the earlier hardening stays in force: a clear counter-example still grounds a contradiction
      /a clear counter-example to the headline behavior is enough on its own/,
      /never reject it merely because it fails to support/,
    ]) expect(call.system).toMatch(re);
    expect(call.tools[0].input_schema.properties.verdict.enum).toEqual(["supported", "unsupported"]);
    expect(call.messages[0].content).toContain("Statement kind: decision statement (what the investor wrote when recording a decision)");
    expect(call.messages[0].content).toContain(T.PARTIAL_REASONING);
  });

  it("labels an interview answer as an interview answer", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", input: { verdict: "supported", reason: "r" } }] });
    await checkEvidenceGrounding({ hypothesisStatement: CLAIM, stance: "supporting", sourceAnswerText: T.A });
    expect(create.mock.calls[0]![0].messages[0].content).toContain("Statement kind: interview answer");
  });
});

describe("proposer contracts (mocked client, prompt capture only)", () => {
  beforeEach(() => vi.clearAllMocks());
  const statements = buildInvestorStatements([{ id: "ans-a", questionText: "q", answerText: T.A }], []);
  const expectV3Proposer = (system: string) => {
    expect(system).toContain(AFFIRMATIVE_STANCE_RULES);
    expect(system).toMatch(/cite a statement as "contradicting" ONLY when its own words affirmatively establish/);
    expect(system).toMatch(/never because the claimed behavior is not mentioned, because the investor did something different, because a partial decision record lacks the consideration, or because the text fails to support the claim/);
    expect(system).toMatch(/not citing it is the correct outcome/);
    expect(system).toMatch(/never restate "you tend to" as "you always"/);
    expect(system).not.toMatch(/partially undercuts/); // the v2 invitation to cite by omission is gone
  };

  it("DNA proposer states the affirmative rule and never invites contradiction by omission", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "propose_hypotheses", input: { hypotheses: [] } }] });
    expect(await proposeDnaHypotheses(statements)).toEqual([]);
    expectV3Proposer(create.mock.calls[0]![0].system);
  });

  it("observed Strategy proposer states the same shared rule", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "propose_observed_principles", input: { principles: [] } }] });
    expect(await proposeObservedPrinciples(statements)).toEqual([]);
    expectV3Proposer(create.mock.calls[0]![0].system);
  });
});

describe("attack cases through the real DNA pipeline (reference gate)", () => {
  it("A supporting -> supported: S=1", async () => {
    const out = await runDna([cite(sid(D.A), "supporting")]);
    expect(countsOf(out.hypotheses[0])).toEqual({ S: 1, C: 0, tier: "insufficient_evidence" });
  });

  it("B contradicting -> unsupported: excluded, C=0 (omission is not the opposite)", async () => {
    const out = await runDna([cite(sid(D.A), "supporting"), cite(sid(D.B), "contradicting")]);
    expect(countsOf(out.hypotheses[0])).toEqual({ S: 1, C: 0, tier: "insufficient_evidence" });
    expect(out.excluded).toEqual([{ statement: CLAIM, statementId: sid(D.B), stance: "contradicting", reason: expect.stringContaining("unsupported as contradicting") }]);
  });

  it("C contradicting -> supported: C=1 (affirmative disregard of price)", async () => {
    const out = await runDna([cite(sid(D.A), "supporting"), cite(sid(D.C), "contradicting")]);
    expect(countsOf(out.hypotheses[0])).toEqual({ S: 1, C: 1, tier: "insufficient_evidence" });
  });

  it("D contradicting -> unsupported: a different action alone is not contradiction", async () => {
    const out = await runDna([cite(sid(D.A), "supporting"), cite(sid(D.D), "contradicting")]);
    expect(countsOf(out.hypotheses[0])).toEqual({ S: 1, C: 0, tier: "insufficient_evidence" });
    expect(out.excluded.map((e) => e.statementId)).toEqual([sid(D.D)]);
  });

  it("E contradicting -> supported: C=1 (knew it was expensive, bought anyway)", async () => {
    const out = await runDna([cite(sid(D.A), "supporting"), cite(sid(D.E), "contradicting")]);
    expect(countsOf(out.hypotheses[0])).toEqual({ S: 1, C: 1, tier: "insufficient_evidence" });
  });

  it("all five together: S=1, C=2, the two silence-shaped contradictions excluded, no stance ever flipped", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await runDna([cite(sid(D.A), "supporting"), cite(sid(D.B), "contradicting"), cite(sid(D.C), "contradicting"), cite(sid(D.D), "contradicting"), cite(sid(D.E), "contradicting")], log);
    expect(countsOf(out.hypotheses[0])).toEqual({ S: 1, C: 2, tier: "insufficient_evidence" });
    expect(out.excluded.map((e) => [e.statementId, e.stance])).toEqual([[sid(D.B), "contradicting"], [sid(D.D), "contradicting"]]);
    // survivors keep exactly the stance the proposer gave them
    expect(out.hypotheses[0]!.evidence.map((e) => [e.decisionStatement?.decisionId, e.stance])).toEqual([[D.A, "supporting"], [D.C, "contradicting"], [D.E, "contradicting"]]);
    // every citation reached the gate with its own stance and as a decision statement
    expect(log.map((l) => [l.sourceKind, l.stance])).toEqual([["decision_statement", "supporting"], ["decision_statement", "contradicting"], ["decision_statement", "contradicting"], ["decision_statement", "contradicting"], ["decision_statement", "contradicting"]]);
  });

  it("vague, uncertain, irrelevant and partial-record texts contribute to NEITHER side under either stance; a claim with nothing left is dropped", async () => {
    for (const stance of ["supporting", "contradicting"] as const) {
      const out = await runDna([cite(sid(D.VAGUE), stance), cite(sid(D.UNCERTAIN), stance), cite(sid(D.IRRELEVANT), stance), cite(sid(D.PARTIAL), stance)]);
      expect(out.hypotheses).toEqual([]);
      expect(out.droppedHypotheses).toEqual([CLAIM]);
      expect(out.excluded).toHaveLength(4);
    }
    // unsupported support contributes S=0; unsupported contradiction contributes C=0 — mixed with one real support
    const out = await runDna([cite(sid(D.A), "supporting"), cite(sid(D.B), "supporting"), cite(sid(D.PARTIAL), "contradicting")]);
    expect(countsOf(out.hypotheses[0])).toEqual({ S: 1, C: 0, tier: "insufficient_evidence" });
  });

  it("decision reasoning, risks and exit conditions each reach the gate as a decision statement; several statements of ONE decision are ONE case", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await runDna([cite(sid(D.MULTI, "reasoning"), "supporting"), cite(sid(D.MULTI, "risks"), "supporting"), cite(sid(D.MULTI, "exit_conditions"), "supporting")], log);
    expect(log.map((l) => l.sourceKind)).toEqual(["decision_statement", "decision_statement", "decision_statement"]);
    expect(log.map((l) => l.sourceAnswerText)).toEqual([T.A, T.RISKS, T.EXIT]);
    // reasoning + risks survive (both affirmative), exit conditions are irrelevant -> excluded; still ONE case
    expect(out.hypotheses[0]!.evidence).toHaveLength(2);
    expect(countsOf(out.hypotheses[0])).toEqual({ S: 1, C: 0, tier: "insufficient_evidence" });
    expect(out.hypotheses[0]!.independenceBasis.groups).toHaveLength(1);
  });

  it("an interview answer reaches the gate as an interview answer", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await runDna([cite("ans-a", "supporting"), cite("ans-b", "contradicting")], log);
    expect(log.map((l) => [l.sourceKind, l.stance])).toEqual([["interview_answer", "supporting"], ["interview_answer", "contradicting"]]);
    expect(countsOf(out.hypotheses[0])).toEqual({ S: 1, C: 0, tier: "insufficient_evidence" });
  });

  it("mixed affirmative clauses: affirmative for either stance; cited both ways for ONE decision it is ONE vote and the contradiction wins", async () => {
    expect(countsOf((await runDna([cite(sid(D.MIXED), "contradicting")])).hypotheses[0])).toEqual({ S: 0, C: 1, tier: "insufficient_evidence" });
    expect(countsOf((await runDna([cite(sid(D.MIXED), "supporting")])).hypotheses[0])).toEqual({ S: 1, C: 0, tier: "insufficient_evidence" });
    const both = await runDna([cite(sid(D.MIXED), "supporting"), cite(sid(D.MIXED), "contradicting")]);
    expect(countsOf(both.hypotheses[0])).toEqual({ S: 0, C: 1, tier: "insufficient_evidence" });
    expect(both.hypotheses[0]!.independenceBasis.groups).toHaveLength(1);
  });

  it("an UNRESOLVED decision contributes neither, whatever the verdict", async () => {
    const out = await runDna([cite(sid(D.UNRESOLVED), "contradicting"), cite(sid(D.A), "supporting")]);
    expect(countsOf(out.hypotheses[0])).toEqual({ S: 1, C: 0, tier: "insufficient_evidence" });
    expect(out.hypotheses[0]!.independenceBasis.unresolvedDecisionIds).toEqual([D.UNRESOLVED]);
    const alone = await runDna([cite(sid(D.UNRESOLVED), "contradicting")]);
    expect(countsOf(alone.hypotheses[0])).toEqual({ S: 0, C: 0, tier: "insufficient_evidence" });
  });

  it("the threshold table is untouched: confidence moves only through S and C", () => {
    expect([calculateEvidenceStrength(2, 0), calculateEvidenceStrength(3, 0), calculateEvidenceStrength(3, 2), calculateEvidenceStrength(3, 3), calculateEvidenceStrength(5, 1), calculateEvidenceStrength(5, 2)]).toEqual([
      "insufficient_evidence", "moderate", "moderate", "weak", "strong", "moderate",
    ]);
  });
});

describe("observed Strategy pipeline parity", () => {
  it("the same citations give the same S/C, exclusions and sourceKinds through the Strategy grounding path", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const cites = [cite(sid(D.A), "supporting"), cite(sid(D.B), "contradicting"), cite(sid(D.C), "contradicting"), cite(sid(D.D), "contradicting"), cite(sid(D.E), "contradicting"), cite(sid(D.MULTI, "risks"), "supporting")];
    const s = await runStrategy(cites, log);
    const d = await runDna(cites);
    expect(countsOf(s.principles[0])).toEqual({ S: 2, C: 2, tier: "insufficient_evidence" });
    expect(countsOf(s.principles[0])).toEqual(countsOf(d.hypotheses[0]));
    expect(s.excluded.map((e) => e.statementId)).toEqual(d.excluded.map((e) => e.statementId));
    expect(new Set(log.map((l) => l.sourceKind))).toEqual(new Set(["decision_statement"]));
    expect(s.principles[0]!.independenceBasis).toEqual(d.hypotheses[0]!.independenceBasis);
  });
});

describe("Learning -> DNA carry runs through the same gate", () => {
  const stmt = (decisionId: string, kind: DecisionStatement["kind"], text: string): DecisionStatement =>
    ({ statementId: sid(decisionId, kind), decisionId, kind, ticker: "X", decisionType: "BUY", decisionDate: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z"), text });

  it("a carried contradiction needs affirmative text too: B is excluded, C survives, every check is a decision statement", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const result = await groundCarryCitations(CLAIM, [{ decisionId: D.A, stance: "supporting" }, { decisionId: D.B, stance: "contradicting" }, { decisionId: D.C, stance: "contradicting" }], [stmt(D.A, "reasoning", T.A), stmt(D.B, "reasoning", T.B), stmt(D.C, "reasoning", T.C)], referenceGate(log));
    expect(result.citations.map((c) => [c.decisionStatement.decisionId, c.stance])).toEqual([[D.A, "supporting"], [D.C, "contradicting"]]);
    expect(result.excluded.map((e) => [e.decisionId, e.stance])).toEqual([[D.B, "contradicting"]]);
    expect(log.every((l) => l.sourceKind === "decision_statement")).toBe(true);
    const assessed = assessCitations(resolver, result.citations);
    expect([assessed.supportingCount, assessed.contradictingCount]).toEqual([1, 1]);
  });
});

describe("remediation provenance shape", () => {
  it("carries the generator, the v3 grounding contract, a null model for deterministic checks, the revalidated version and the rule version", () => {
    const p = buildProvenance({
      generator: "dna.remediateGrounding",
      model: null,
      promptContracts: [AI_CONTRACTS.evidenceGrounding],
      sourceTypes: ["decision_statement"],
      revalidatedVersionId: "v1",
      remediationReason: "grounding-semantics-v3: contradiction requires affirmative evidence",
      semanticRule: STANCE_SEMANTICS_VERSION,
      now: new Date("2026-09-25T00:00:00Z"),
    });
    expect(p).toMatchObject({ generator: "dna.remediateGrounding", model: null, promptContracts: ["evidence-grounding-v3-statements"], revalidatedVersionId: "v1", semanticRule: "grounding-semantics-v3", independencePolicy: "independence-policy-v2", evidenceSourceContract: "evidence-source-v1", generatedAt: "2026-09-25T00:00:00.000Z" });
    expect(p.remediationReason).toContain("grounding-semantics-v3");
    // generation provenance carries none of the remediation-only fields
    const g = buildProvenance({ generator: "dna.generate", model: "m", promptContracts: [AI_CONTRACTS.dnaPropose], sourceTypes: ["interview_answer"] });
    expect("revalidatedVersionId" in g || "remediationReason" in g || "semanticRule" in g).toBe(false);
  });
});
