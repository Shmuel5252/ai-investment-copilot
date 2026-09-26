// Grounding Semantics V3.1 (Owner decision frozen 2026-09-25): MATERIAL
// PRECONDITIONS. A conditional claim ("when X, you tend to Y") is supported
// only by a statement that itself establishes X and Y, and contradicted only
// by one that establishes X and then shows not-Y; behavior while X is unknown
// is NEITHER. Qualification is citation-local.
//
// Pins (1) the V3.1 contract ids, (2) the rule text sent by the gate and both
// proposers, and (3) the Owner's precondition attack cases A..H plus the edge
// cases through the REAL pipeline (validate -> ground -> resolver ->
// threshold). No model is called: the client is mocked for prompt capture; a
// REFERENCE gate encodes the frozen rule for the fixture texts so the tests
// prove what the code does with each verdict, never what a live model says.
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
import { createIndependenceResolver } from "@/lib/evidence/resolve-independence";
import { contextFromTrades } from "../helpers/independence";

const create = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;
type Stance = "supporting" | "contradicting";

const CLAIM_MOMENTUM = "When momentum weakens, you tend to sell.";
const CLAIM_TARGET = "If an external target is missed, you tend to exit.";
const CLAIM_MULTI = "When a position is up a lot and its momentum weakens, you tend to sell.";
/** d5941418-shaped: two triggers joined by OR. */
const CLAIM_REAL_LIKE = "You tend to sell a stock when its momentum weakens or when it misses an external target set for it, even at a small loss.";

// Generic fixture texts (the Owner's A..H plus edge cases). Never real investor text.
const T = {
  A: "Momentum weakened and I sold.",
  B: "Momentum weakened and I continued holding.",
  C: "I held while momentum remained strong.",
  D: "I held.",
  E: "I sold.",
  F: "The target was missed, so I sold.",
  G: "The target was missed, but I kept holding.",
  H: "I held for six months.",
  AMBIGUOUS: "Momentum may have weakened, I am not sure; I sold anyway.",
  NOT_OCCURRED: "Momentum did not weaken at all; I sold to fund another idea.",
  MULTI_ONE_MISSING: "The position was up a lot and I sold.",
  MULTI_BOTH: "The position was up a lot, momentum weakened, and I sold.",
  /** MRVL-shaped: held while it kept rising, no trigger established. */
  REAL_LIKE_HOLD: "I did not wait for a target or a signal; as long as it kept rising I stayed with it because I believe in the company.",
  /** CAN-shaped: an external target was missed, the stock kept declining, sold. */
  REAL_LIKE_SELL: "The exchange set a target to cross a threshold within a period; the stock kept declining and missed it, so I sold and used the money elsewhere.",
  TRIGGER_ONLY: "Momentum has clearly weakened.",
  ACTION_ONLY: "I am holding.",
} as const;

/** Every (text, stance) the frozen rule accepts as affirmative; everything else is NEITHER for these conditional claims. */
const SUPPORTED = new Set<string>([
  `${T.A}::supporting`, `${T.B}::contradicting`, `${T.F}::supporting`, `${T.G}::contradicting`, `${T.MULTI_BOTH}::supporting`, `${T.REAL_LIKE_SELL}::supporting`,
]);
function referenceGate(log: EvidenceGroundingCheckInput[]) {
  return async (input: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> => {
    log.push(input);
    const ok = SUPPORTED.has(`${input.sourceAnswerText}::${input.stance}`);
    return { verdict: ok ? "supported" : "unsupported", reason: ok ? `reference ${STANCE_SEMANTICS_VERSION}: precondition and behavior established` : `reference ${STANCE_SEMANTICS_VERSION}: material precondition not established or no affirmative behavior` };
  };
}

// One own-case decision per fixture text; one decision carrying the trigger in
// its risks text and the action in its reasoning text (citation-local case).
const KEYS = Object.keys(T) as (keyof typeof T)[];
const sid = (decisionId: string, kind: "reasoning" | "risks" | "exit_conditions" = "reasoning") => `decision:${decisionId}:${kind}`;
const D = Object.fromEntries(KEYS.map((k) => [k, `d-${k.toLowerCase()}`])) as Record<keyof typeof T, string>;
const SPLIT = "d-split";
const TEXT_BY_ID = new Map<string, string>([
  ...KEYS.map((k) => [sid(D[k]), T[k]] as [string, string]),
  [sid(SPLIT, "risks"), T.TRIGGER_ONLY], [sid(SPLIT, "reasoning"), T.ACTION_ONLY],
]);
const resolver = createIndependenceResolver({
  ...contextFromTrades([], []),
  decisions: [...KEYS.map((k) => ({ id: D[k], caseResolution: { kind: "own" as const } })), { id: SPLIT, caseResolution: { kind: "own" as const } }],
});
const cite = (statementId: string, stance: Stance) => ({ statementId, stance, description: `cites ${statementId}` });
async function runDna(claim: string, cites: ReturnType<typeof cite>[], log: EvidenceGroundingCheckInput[] = []) {
  const validated = validateProposedHypotheses([{ statement: claim, evidence: cites }], resolver);
  return groundValidatedHypotheses(validated, TEXT_BY_ID, resolver, referenceGate(log));
}
async function runStrategy(claim: string, cites: ReturnType<typeof cite>[]) {
  const validated = validateProposedObservedPrinciples([{ statement: claim, evidence: cites }], resolver);
  return groundValidatedObservedPrinciples(validated, TEXT_BY_ID, resolver, referenceGate([]));
}
const sc = (h: { supportingCount: number; contradictingCount: number } | undefined) => (h ? [h.supportingCount, h.contradictingCount] : null);

describe("V3.1 contract ids and canonical rule", () => {
  it("bumps the three semantic contracts to v3-1 and leaves identity/learning alone", () => {
    expect(AI_CONTRACTS.evidenceGrounding).toBe("evidence-grounding-v3-1-statements");
    expect(AI_CONTRACTS.dnaPropose).toBe("dna-propose-v3-1-statements");
    expect(AI_CONTRACTS.strategyObserve).toBe("strategy-observe-v3-1-statements");
    expect(AI_CONTRACTS.hypothesisIdentity).toBe("hypothesis-identity-v1");
    expect(AI_CONTRACTS.learningPropose).toBe("learning-propose-v1");
    expect(STANCE_SEMANTICS_VERSION).toBe("grounding-semantics-v3-1");
  });

  it("the shared rule defines material preconditions, the four-step test, the disqualified sources, both examples and citation-local qualification", () => {
    for (const phrase of [
      "MATERIAL PRECONDITIONS: a material precondition is a condition the CLAIM ITSELF requires to hold before its behavioral proposition applies",
      "(1) identify the behavioral proposition",
      "(2) identify its material preconditions from the claim itself — never add a precondition the claim does not contain and never invent extra triggers",
      "(3) require the statement's own words to affirmatively establish those preconditions",
      "(4) only then ask whether the statement affirmatively establishes the behavior (SUPPORTING) or a behavior or belief inconsistent with it (CONTRADICTING)",
      "absent, ambiguous, merely inferred, supplied from outside the statement, or known only from market data, hindsight, outcomes, Later Context or another uncited statement",
      "behavior outside the claim's trigger conditions is not a counter-example",
      "an action taken while the trigger is unknown does not prove the conditional pattern",
      "Do not infer that a trigger occurred",
      "\"I held while the stock kept rising\" is NEITHER",
      "\"momentum clearly weakened, but I kept holding because I expected a rebound\" is CONTRADICTING",
      "\"I held the position for six months\" is NEITHER unless the statement establishes that the target was missed while the investor kept holding",
      "Qualification is citation-local",
      "never combine the trigger from one statement with the action from another",
      // V3 stays in force
      "Absence of mention is not evidence of absence",
      "Unsupported is not contradiction",
      "not a universal claim",
    ]) expect(AFFIRMATIVE_STANCE_RULES).toContain(phrase);
  });
});

describe("prompts carry V3.1 (mocked client, prompt capture only)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grounding gate: precondition procedure for contradicting and the symmetric conditional rule for supporting", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "record_grounding_verdict", input: { verdict: "unsupported", reason: "r" } }] });
    await checkEvidenceGrounding({ hypothesisStatement: CLAIM_MOMENTUM, stance: "contradicting", sourceAnswerText: T.C });
    const system = create.mock.calls[0]![0].system as string;
    expect(system).toContain(AFFIRMATIVE_STANCE_RULES);
    expect(system).toMatch(/Apply MATERIAL PRECONDITIONS before judging/);
    expect(system).toMatch(/behavior outside the trigger conditions, or while the trigger is unknown, is not a counter-example and is unsupported/);
    expect(system).toMatch(/When the claim is conditional \("when X, tends to Y"\), the statement must itself establish the material precondition X and the behavior Y/);
  });

  it("both proposers: conditional patterns need the trigger in the cited statement; no filling from history, outcome, Later Context, other statements or general knowledge", async () => {
    const statements = buildInvestorStatements([{ id: "ans-a", questionText: "q", answerText: T.A }], []);
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "propose_hypotheses", input: { hypotheses: [] } }] });
    await proposeDnaHypotheses(statements);
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "propose_observed_principles", input: { principles: [] } }] });
    await proposeObservedPrinciples(statements);
    for (const call of create.mock.calls) {
      const system = call[0].system as string;
      expect(system).toContain(AFFIRMATIVE_STANCE_RULES);
      expect(system).toMatch(/Conditional patterns \("when X, you tend to Y"\): cite a statement as supporting or contradicting ONLY when the statement itself establishes the material trigger X and the behavior/);
      expect(system).toMatch(/Never fill a missing trigger from ticker or price history, outcomes, Later Context, other statements or general knowledge/);
      expect(system).toMatch(/evidence qualification is citation-local/);
    }
  });
});

describe("precondition attack cases through the real pipeline (reference gate)", () => {
  it("A: trigger + behavior -> SUPPORTING (S=1)", async () => {
    expect(sc((await runDna(CLAIM_MOMENTUM, [cite(sid(D.A), "supporting")])).hypotheses[0])).toEqual([1, 0]);
  });
  it("B: trigger + opposite behavior -> CONTRADICTING (C=1)", async () => {
    expect(sc((await runDna(CLAIM_MOMENTUM, [cite(sid(D.B), "contradicting")])).hypotheses[0])).toEqual([0, 1]);
  });
  it("C: held while momentum remained strong -> NEITHER under either stance", async () => {
    for (const stance of ["supporting", "contradicting"] as const) {
      const out = await runDna(CLAIM_MOMENTUM, [cite(sid(D.C), stance)]);
      expect(out.hypotheses).toEqual([]);
      expect(out.excluded.map((e) => e.stance)).toEqual([stance]);
    }
  });
  it("D: 'I held' -> NEITHER; E: 'I sold' -> NEITHER (trigger unknown never proves the conditional pattern)", async () => {
    for (const [d, stance] of [[D.D, "contradicting"], [D.D, "supporting"], [D.E, "supporting"], [D.E, "contradicting"]] as const) {
      expect((await runDna(CLAIM_MOMENTUM, [cite(sid(d), stance)])).hypotheses).toEqual([]);
    }
  });
  it("F: target missed, sold -> SUPPORTING; G: target missed, kept holding -> CONTRADICTING; H: held six months -> NEITHER", async () => {
    expect(sc((await runDna(CLAIM_TARGET, [cite(sid(D.F), "supporting")])).hypotheses[0])).toEqual([1, 0]);
    expect(sc((await runDna(CLAIM_TARGET, [cite(sid(D.G), "contradicting")])).hypotheses[0])).toEqual([0, 1]);
    expect((await runDna(CLAIM_TARGET, [cite(sid(D.H), "contradicting")])).hypotheses).toEqual([]);
    expect((await runDna(CLAIM_TARGET, [cite(sid(D.H), "supporting")])).hypotheses).toEqual([]);
  });
  it("ambiguous trigger and explicitly absent trigger -> NEITHER (an action with the trigger absent is not a counter-example)", async () => {
    for (const d of [D.AMBIGUOUS, D.NOT_OCCURRED]) for (const stance of ["supporting", "contradicting"] as const) {
      expect((await runDna(CLAIM_MOMENTUM, [cite(sid(d), stance)])).hypotheses).toEqual([]);
    }
  });
  it("multiple preconditions: one missing -> NEITHER; both established -> SUPPORTING", async () => {
    expect((await runDna(CLAIM_MULTI, [cite(sid(D.MULTI_ONE_MISSING), "supporting")])).hypotheses).toEqual([]);
    expect(sc((await runDna(CLAIM_MULTI, [cite(sid(D.MULTI_BOTH), "supporting")])).hypotheses[0])).toEqual([1, 0]);
  });
  it("all of A..H for the momentum/target claims together: S counts only trigger-established support, C only trigger-established contradiction", async () => {
    const out = await runDna(CLAIM_MOMENTUM, [cite(sid(D.A), "supporting"), cite(sid(D.B), "contradicting"), cite(sid(D.C), "contradicting"), cite(sid(D.D), "contradicting"), cite(sid(D.E), "supporting")]);
    expect(sc(out.hypotheses[0])).toEqual([1, 1]);
    expect(out.excluded.map((e) => e.statementId)).toEqual([sid(D.C), sid(D.D), sid(D.E)]);
    expect(out.hypotheses[0]!.evidence.map((e) => e.stance)).toEqual(["supporting", "contradicting"]); // never flipped
  });
  it("tendency wording changes nothing: the trigger is still required", async () => {
    expect((await runDna("You tend to sell when momentum weakens.", [cite(sid(D.C), "contradicting")])).hypotheses).toEqual([]);
    expect(sc((await runDna("You tend to sell when momentum weakens.", [cite(sid(D.B), "contradicting")])).hypotheses[0])).toEqual([0, 1]);
  });
  it("citation-local: a decision whose risks text holds the trigger and whose reasoning holds the action is NEITHER for each statement; the pipeline never combines them", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await runDna(CLAIM_MOMENTUM, [cite(sid(SPLIT, "risks"), "contradicting"), cite(sid(SPLIT, "reasoning"), "contradicting")], log);
    expect(out.hypotheses).toEqual([]);
    expect(out.droppedHypotheses).toEqual([CLAIM_MOMENTUM]);
    // each call carried exactly ONE statement's text — never a concatenation
    expect(log.map((l) => l.sourceAnswerText)).toEqual([T.TRIGGER_ONLY, T.ACTION_ONLY]);
    expect(log.every((l) => l.sourceKind === "decision_statement")).toBe(true);
  });
  it("partial decision statement: a decision reasoning text silent about the trigger is NEITHER", async () => {
    expect((await runDna(CLAIM_MOMENTUM, [cite(sid(D.D), "contradicting")])).excluded).toHaveLength(1);
  });
});

describe("real-case regression fixture (d5941418 shape, deterministic)", () => {
  it("held while rising, no trigger established -> contradicting is UNSUPPORTED; the CAN-shaped missed-target sale still supports", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await runDna(CLAIM_REAL_LIKE, [cite(sid(D.REAL_LIKE_SELL), "supporting"), cite(sid(D.REAL_LIKE_HOLD), "contradicting")], log);
    expect(sc(out.hypotheses[0])).toEqual([1, 0]);
    expect(out.excluded).toEqual([{ statement: CLAIM_REAL_LIKE, statementId: sid(D.REAL_LIKE_HOLD), stance: "contradicting", reason: expect.stringContaining("material precondition not established") }]);
    expect(log.find((l) => l.sourceAnswerText === T.REAL_LIKE_HOLD)!.stance).toBe("contradicting");
    // and the same text does not support the claim either (trigger unknown)
    expect((await runDna(CLAIM_REAL_LIKE, [cite(sid(D.REAL_LIKE_HOLD), "supporting")])).hypotheses).toEqual([]);
  });
});

describe("Strategy parity and Learning carry", () => {
  it("the observed-Strategy path gives the same outcome for the momentum cases", async () => {
    const s = await runStrategy(CLAIM_MOMENTUM, [cite(sid(D.A), "supporting"), cite(sid(D.B), "contradicting"), cite(sid(D.C), "contradicting")]);
    const d = await runDna(CLAIM_MOMENTUM, [cite(sid(D.A), "supporting"), cite(sid(D.B), "contradicting"), cite(sid(D.C), "contradicting")]);
    expect(sc(s.principles[0])).toEqual([1, 1]);
    expect(s.excluded.map((e) => e.statementId)).toEqual(d.excluded.map((e) => e.statementId));
  });
  it("a carried contradiction whose trigger is not established is excluded", async () => {
    const stmt = (decisionId: string, text: string): DecisionStatement => ({ statementId: sid(decisionId), decisionId, kind: "reasoning", ticker: "X", decisionType: "BUY", decisionDate: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z"), text });
    const result = await groundCarryCitations(CLAIM_MOMENTUM, [{ decisionId: D.B, stance: "contradicting" }, { decisionId: D.C, stance: "contradicting" }], [stmt(D.B, T.B), stmt(D.C, T.C)], referenceGate([]));
    expect(result.citations.map((c) => c.decisionStatement.decisionId)).toEqual([D.B]);
    expect(result.excluded.map((e) => e.decisionId)).toEqual([D.C]);
  });
});
