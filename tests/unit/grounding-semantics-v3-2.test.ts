// Grounding Semantics V3.2 (Owner decisions OD-V32-1..6 frozen 2026-09-27):
// COMPOUND CLAIMS. A citation qualifies a claim only when the investor's own
// words establish every material component its stance requires; a partial
// match is NEITHER. Proposers state one behavioral proposition per claim.
//
// Pins (1) the V3.2 contract ids, (2) the rule text sent by the gate and both
// proposers, (3) the compound attack cases and the two real-case regression
// fixtures through the REAL pipeline (validate -> ground -> resolver ->
// threshold), (4) both remediation planners and the Learning carry. No model
// is called: the client is mocked for prompt capture; a REFERENCE gate
// (tests/helpers/reference-gate-v3-2.ts) encodes the frozen rule for the
// fixture texts.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: "claude-sonnet-5",
}));

import { anthropic } from "@/lib/ai/client";
import { AI_CONTRACTS } from "@/lib/ai/contracts";
import { AFFIRMATIVE_STANCE_RULES, CLAIM_ATOMICITY_RULES, STANCE_SEMANTICS_VERSION } from "@/lib/ai/stance-rules";
import { checkEvidenceGrounding, type EvidenceGroundingCheckInput } from "@/lib/ai/dna-grounding";
import { proposeDnaHypotheses } from "@/lib/ai/dna";
import { proposeObservedPrinciples } from "@/lib/ai/strategy";
import { buildInvestorStatements } from "@/lib/ai/investor-statements";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import { groundValidatedHypotheses } from "@/lib/dna/ground-evidence";
import { validateProposedObservedPrinciples } from "@/lib/strategy/validate-principles";
import { groundValidatedObservedPrinciples } from "@/lib/strategy/ground-evidence";
import { planGroundingRemediation } from "@/lib/dna/remediate-grounding";
import { planPrincipleGroundingRemediation } from "@/lib/strategy/remediate-grounding";
import { groundCarryCitations } from "@/lib/learning/carry-to-dna";
import { buildProvenance } from "@/lib/evidence/provenance";
import { calculateEvidenceStrength } from "@/lib/dna/evidence-strength";
import type { DecisionStatement } from "@/lib/evidence/decision-statements";
import { createIndependenceResolver } from "@/lib/evidence/resolve-independence";
import { contextFromTrades } from "../helpers/independence";
import { referenceGate, type ReferenceWorld } from "../helpers/reference-gate-v3-2";

const create = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;
type Stance = "supporting" | "contradicting";

const C = {
  AND: "When a position is up a lot and its momentum weakens, you tend to sell.",
  OR: "When momentum weakens or an external target is missed, you tend to sell.",
  MOTIVE: "You tend to sell winning positions because you fear losing the gain.",
  COND_MOTIVE: "When momentum weakens, you tend to sell because you fear losing the gain.",
  /** The persisted 7c3665ca claim wording (AI-written claim text, not investor text). */
  CALL8: "You tend to hold onto positions as long as the stock keeps climbing and you believe in the company, without a predefined exit signal or target.",
  /** The persisted 3653aeed principle wording. */
  CALL13: "You seem to hold onto positions based on belief in the company/story rather than a predefined exit rule, letting price momentum dictate how long you stay in.",
  SCOPE: "You tend to avoid leverage, especially when you lack specific information.",
  BUNDLED: "You hold on belief in the company, and you take partial profits to fund new ideas.",
} as const;

// Generic or sanitized fixture texts. Never real investor text.
const T = {
  XZY: "The position was up a lot, momentum weakened, and I sold.",
  XZ_NOT_Y: "The position was up a lot and momentum weakened, but I kept holding.",
  XY: "The position was up a lot and I sold.",
  ZY: "Momentum weakened and I sold.",
  X_NOT_Y: "The position was up a lot and I kept holding.",
  MISS_Y: "The external target was missed, so I sold.",
  Z_NOT_Y: "Momentum weakened, but I kept holding.",
  Y_ONLY: "I sold.",
  MOTIVE_FULL: "It was a winning position and I sold it because I was afraid of losing the gain.",
  MOTIVE_Y_ONLY: "It was a winning position and I sold it.",
  MOTIVE_NOT_Y: "It was a winning position and I deliberately kept holding it.",
  COND_FULL: "Momentum weakened and I sold because I was afraid of losing the gain.",
  /** call-8 shaped: a large rise, a feared correction, doubt it can continue. No belief in the company; the sale itself is not stated. */
  CALL8_CITATION: "I did not want to lose the profit; after such a big rise a correction felt likely, and I doubted a stock could keep rising like that.",
  CALL8_COUNTER: "The stock kept climbing and I still believed in the company, but I sold anyway.",
  /** call-7 shaped: both conditions, the behavior and the absence of an exit rule. */
  CALL8_SUPPORT: "I did not wait for a target or a signal; as long as it kept rising I stayed with it because I believe in the company.",
  /** call-13 shaped: belief, still holding, no exit rule. Nothing about price momentum. */
  CALL13_CITATION: "It was a very large IPO and I felt the company would dominate its field. I am still holding; I am waiting for a good point to sell or to stay longer, I have not decided, and if I get a good chance to sell at a profit I will.",
  CALL13_SUPPORT: "I believe in the company and I have no exit rule; I simply stay in for as long as the price keeps its momentum.",
  AVOID_LEVERAGE: "I stay away from leverage.",
  BELIEF_HOLD: "I hold because I believe in the company.",
  PARTIAL_PROFIT: "I took partial profits to fund new ideas.",
} as const;

const Q = {
  CALL8: "With a large gain after a short holding period, what made you decide to sell then rather than hold on for more upside?",
  CALL13: "What made this stock stand out enough to become your largest buy?",
} as const;

const WORLD: ReferenceWorld = {
  claims: {
    [C.AND]: { support: [["UP", "WEAK", "SELL"]], contradict: [["UP", "WEAK", "HOLD"]] },
    [C.OR]: { support: [["WEAK", "SELL"], ["MISS", "SELL"]], contradict: [["WEAK", "HOLD"], ["MISS", "HOLD"]] },
    [C.MOTIVE]: { support: [["WIN", "SELL", "FEAR"]], contradict: [["WIN", "HOLD"]] },
    [C.COND_MOTIVE]: { support: [["WEAK", "SELL", "FEAR"]], contradict: [["WEAK", "HOLD"]] },
    [C.CALL8]: { support: [["CLIMB", "BELIEF", "HOLD", "NO_EXIT_RULE"]], contradict: [["CLIMB", "BELIEF", "SELL"]] },
    [C.CALL13]: { support: [["HOLD", "BELIEF", "NO_EXIT_RULE", "MOMENTUM_DURATION"]], contradict: [["EXIT_RULE"]] },
    // "especially when ..." is emphasis: the base proposition does not need it
    [C.SCOPE]: { support: [["AVOID_LEVERAGE"]], contradict: [["USE_LEVERAGE"]] },
    [C.BUNDLED]: { support: [["HOLD", "BELIEF", "PARTIAL_PROFIT", "FUND_NEW"]], contradict: [] },
  },
  says: {
    [T.XZY]: ["UP", "WEAK", "SELL"],
    [T.XZ_NOT_Y]: ["UP", "WEAK", "HOLD"],
    [T.XY]: ["UP", "SELL"],
    [T.ZY]: ["WEAK", "SELL"],
    [T.X_NOT_Y]: ["UP", "HOLD"],
    [T.MISS_Y]: ["MISS", "SELL"],
    [T.Z_NOT_Y]: ["WEAK", "HOLD"],
    [T.Y_ONLY]: ["SELL"],
    [T.MOTIVE_FULL]: ["WIN", "SELL", "FEAR"],
    [T.MOTIVE_Y_ONLY]: ["WIN", "SELL"],
    [T.MOTIVE_NOT_Y]: ["WIN", "HOLD"],
    [T.COND_FULL]: ["WEAK", "SELL", "FEAR"],
    // generous on purpose: the rise is read as "keeps climbing", so ONLY the belief component is missing
    [T.CALL8_CITATION]: ["CLIMB", "FEAR"],
    [T.CALL8_COUNTER]: ["CLIMB", "BELIEF", "SELL"],
    [T.CALL8_SUPPORT]: ["CLIMB", "BELIEF", "HOLD", "NO_EXIT_RULE"],
    [T.CALL13_CITATION]: ["BELIEF", "HOLD", "NO_EXIT_RULE"],
    [T.CALL13_SUPPORT]: ["BELIEF", "HOLD", "NO_EXIT_RULE", "MOMENTUM_DURATION"],
    [T.AVOID_LEVERAGE]: ["AVOID_LEVERAGE"],
    [T.BELIEF_HOLD]: ["HOLD", "BELIEF"],
    [T.PARTIAL_PROFIT]: ["PARTIAL_PROFIT", "FUND_NEW"],
  },
  reasonAnswers: new Set<string>([T.CALL8_CITATION, T.CALL13_CITATION]),
  // the question resolves the ACTION under discussion — never the gain, the holding period or "largest"
  asks: { [Q.CALL8]: ["SELL"], [Q.CALL13]: ["BUY"] },
};

// One interview answer per fixture text, each on its own trade (own position
// episode = own independent case), plus one decision per text for the
// decision-statement path.
const KEYS = Object.keys(T) as (keyof typeof T)[];
const A = Object.fromEntries(KEYS.map((k) => [k, `ans-${k.toLowerCase()}`])) as Record<keyof typeof T, string>;
const D = Object.fromEntries(KEYS.map((k) => [k, `dec-${k.toLowerCase()}`])) as Record<keyof typeof T, string>;
const dsid = (decisionId: string) => `decision:${decisionId}:reasoning`;
const resolver = createIndependenceResolver({
  ...contextFromTrades(
    KEYS.map((k, i) => ({ id: `t-${k}`, ticker: `TK${i}`, type: "buy" as const, date: "2026-01-05" })),
    KEYS.map((k) => ({ id: A[k], txn: `t-${k}`, text: T[k] }))
  ),
  decisions: KEYS.map((k) => ({ id: D[k], caseResolution: { kind: "own" as const } })),
});
const TEXT_BY_ID = new Map<string, string>([...KEYS.map((k) => [A[k], T[k]] as [string, string]), ...KEYS.map((k) => [dsid(D[k]), T[k]] as [string, string])]);
const CONTEXT_BY_ID = new Map<string, string>([[A.CALL8_CITATION, Q.CALL8], [A.CALL13_CITATION, Q.CALL13]]);

const cite = (statementId: string, stance: Stance) => ({ statementId, stance, description: `cites ${statementId}` });
async function runDna(claim: string, cites: ReturnType<typeof cite>[], log: EvidenceGroundingCheckInput[] = []) {
  const validated = validateProposedHypotheses([{ statement: claim, evidence: cites }], resolver);
  return groundValidatedHypotheses(validated, TEXT_BY_ID, resolver, referenceGate(WORLD, log), CONTEXT_BY_ID);
}
async function runStrategy(claim: string, cites: ReturnType<typeof cite>[], log: EvidenceGroundingCheckInput[] = []) {
  const validated = validateProposedObservedPrinciples([{ statement: claim, evidence: cites }], resolver);
  return groundValidatedObservedPrinciples(validated, TEXT_BY_ID, resolver, referenceGate(WORLD, log), CONTEXT_BY_ID);
}
const sc = (h: { supportingCount: number; contradictingCount: number } | undefined) => (h ? [h.supportingCount, h.contradictingCount] : null);
const neither = async (claim: string, key: keyof typeof T) => {
  for (const stance of ["supporting", "contradicting"] as const) {
    const out = await runDna(claim, [cite(A[key], stance)]);
    expect(out.hypotheses).toEqual([]);
    expect(out.excluded.map((e) => [e.statementId, e.stance])).toEqual([[A[key], stance]]);
  }
};

describe("V3.2 contract ids and canonical rule", () => {
  it("bumps the three semantic contracts to v3-2 and leaves identity/learning alone", () => {
    expect(AI_CONTRACTS).toEqual({
      dnaPropose: "dna-propose-v3-2-statements",
      strategyObserve: "strategy-observe-v3-2-statements",
      evidenceGrounding: "evidence-grounding-v3-2-statements",
      hypothesisIdentity: "hypothesis-identity-v1",
      learningPropose: "learning-propose-v1",
    });
    expect(STANCE_SEMANTICS_VERSION).toBe("grounding-semantics-v3-2");
  });

  it("the shared rule states OD-V32-1..5 once: partial match, AND, OR, motive, role by wording, ambiguous role, scope", () => {
    for (const phrase of [
      // OD-V32-1
      "A citation qualifies for a stance only when the statement's own words affirmatively establish EVERY material component that stance requires",
      "a partial match is never evidence for the whole claim: it is NEITHER",
      "A required component that is missing, ambiguous, merely inferred, or supplied only by context is not established",
      // OD-V32-2
      "SUPPORTING requires X, Z and Y. CONTRADICTING requires X, Z and a behavior affirmatively inconsistent with Y",
      "X with Y only, Z with Y only, and X with not-Y only are each NEITHER",
      "SUPPORTING requires at least one branch (X or Z) and Y",
      "CONTRADICTING requires at least one applicable branch (X or Z) and a behavior affirmatively inconsistent with Y",
      "Evidence for one branch says nothing about the other branch; do not infer a missing branch",
      // OD-V32-3
      "SUPPORTING requires X when the claim has one, Y, and Z as the claimed motive or basis",
      "a statement showing Y alone is a partial match and NEITHER",
      "it does not require Z, and a failure to establish Z never by itself establishes contradiction",
      // OD-V32-4
      "a component inside the grammatical scope of \"when\", \"if\", \"after\", \"while\" or \"as long as\" is a material precondition unless the claim's wording clearly marks a different role",
      "a component marked by \"because\", \"based on\", \"out of\" or \"in order to\" is a motive, basis or purpose",
      "never reclassify a worded precondition as a motive because of where the claim came from or what another source suggests",
      "If a material component's role is genuinely ambiguous, fail closed — treat it as required, never silently drop it",
      // contrast clarification (frozen with OD-R9)
      "a contrast word is not automatically a separate material component — determine its role in the claim",
      "If it asserts an independent behavioral property of its own (\"without a predefined exit rule\"), that property must be established for SUPPORTING the whole claim",
      "If it merely restates or negates the primary behavioral proposition (\"you cut the position rather than hold it\"), it adds no requirement — do not double-count it",
      "CONTRADICTING requires only the components the rules above require, never the contrast as an extra one",
      "If the role of the contrast is genuinely ambiguous, fail closed — treat it as required",
      // OD-V32-5
      "It is not automatically a material precondition, and the base behavioral proposition does not need it established",
      "it also never broadens what a statement establishes beyond the statement's own words",
      // V3 and V3.1 stay in force, verbatim
      "Absence of mention is not evidence of absence",
      "Unsupported is not contradiction",
      "Do not infer that a trigger occurred",
      "Qualification is citation-local",
    ]) expect(AFFIRMATIVE_STANCE_RULES).toContain(phrase);
  });

  it("the atomicity rule (OD-V32-6) allows compound preconditions and forbids joined tendencies", () => {
    for (const phrase of [
      "each hypothesis states ONE independently testable behavioral proposition",
      "its motive or basis when that motive is itself part of the proposition",
      "Legitimate compound preconditions are allowed: several triggers on ONE behavior are one claim",
      "Do not split one behavioral rule into unnatural fragments",
      "Do not join separable behavioral tendencies into one claim",
      "do not append an independent second tendency merely because the same statement mentions it",
      "Every material component you write into a claim",
      "leave it out rather than cite a partial match",
    ]) expect(CLAIM_ATOMICITY_RULES).toContain(phrase);
    // the canonical stance rule is NOT duplicated inside the atomicity text
    expect(CLAIM_ATOMICITY_RULES).not.toContain("Absence of mention is not evidence of absence");
  });
});

describe("prompts carry V3.2 (mocked client, prompt capture only)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grounding gate: the shared rule, the compound instruction in both branches, and no claim-construction text", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "record_grounding_verdict", input: { verdict: "unsupported", reason: "r" } }] });
    await checkEvidenceGrounding({ hypothesisStatement: C.CALL8, stance: "contradicting", sourceAnswerText: T.CALL8_CITATION });
    const system = create.mock.calls[0]![0].system as string;
    expect(system).toContain(AFFIRMATIVE_STANCE_RULES);
    expect(system).toMatch(/Apply COMPOUND CLAIMS: the statement must establish every material component the claim asserts — a partial match is unsupported/);
    expect(system).toMatch(/Apply COMPOUND CLAIMS before using this motive rule: a component the claim words as a condition \(inside "when", "if", "after", "while" or "as long as"\) is a precondition the statement must establish, never an attributed motive to set aside/);
    // the V3 motive rule for contradictions stays: a counter-example never needs the motive
    expect(system).toMatch(/a clear counter-example to the headline behavior is enough on its own/);
    expect(system).not.toContain("CLAIM ATOMICITY");
  });

  it("both proposers: the shared rule, the compound and question line, and the ONE atomicity text", async () => {
    const statements = buildInvestorStatements([{ id: "ans-a", questionText: "q", answerText: T.XZY }], []);
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "propose_hypotheses", input: { hypotheses: [] } }] });
    await proposeDnaHypotheses(statements);
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: "propose_observed_principles", input: { principles: [] } }] });
    await proposeObservedPrinciples(statements);
    expect(create.mock.calls).toHaveLength(2);
    for (const call of create.mock.calls) {
      const system = call[0].system as string;
      expect(system).toContain(AFFIRMATIVE_STANCE_RULES);
      expect(system).toContain(CLAIM_ATOMICITY_RULES);
      expect(system.split("CLAIM ATOMICITY:").length - 1).toBe(1);
      expect(system).toMatch(/cite a statement for a claim ONLY when it establishes every material component that stance requires \(COMPOUND CLAIMS above\) — a partial match is not cited/);
      expect(system).toMatch(/The question shown with an interview answer is context, never evidence/);
    }
  });
});

describe("WHEN (X AND Z) -> Y", () => {
  it("X+Z+Y = support", async () => {
    expect(sc((await runDna(C.AND, [cite(A.XZY, "supporting")])).hypotheses[0])).toEqual([1, 0]);
  });
  it("X+Z+not-Y = contradiction", async () => {
    expect(sc((await runDna(C.AND, [cite(A.XZ_NOT_Y, "contradicting")])).hypotheses[0])).toEqual([0, 1]);
  });
  it("X+Y only = neither; Z+Y only = neither; X+not-Y only = neither", async () => {
    await neither(C.AND, "XY");
    await neither(C.AND, "ZY");
    await neither(C.AND, "X_NOT_Y");
  });
  it("counts only complete matches when all five are cited together; stances are never flipped", async () => {
    const out = await runDna(C.AND, [cite(A.XZY, "supporting"), cite(A.XZ_NOT_Y, "contradicting"), cite(A.XY, "supporting"), cite(A.ZY, "supporting"), cite(A.X_NOT_Y, "contradicting")]);
    expect(sc(out.hypotheses[0])).toEqual([1, 1]);
    expect(out.excluded.map((e) => e.statementId)).toEqual([A.XY, A.ZY, A.X_NOT_Y]);
    expect(out.hypotheses[0]!.evidence.map((e) => e.stance)).toEqual(["supporting", "contradicting"]);
  });
});

describe("WHEN (X OR Z) -> Y", () => {
  it("X+Y = support; Z+Y = support; each branch is its own evidence", async () => {
    expect(sc((await runDna(C.OR, [cite(A.ZY, "supporting")])).hypotheses[0])).toEqual([1, 0]);
    expect(sc((await runDna(C.OR, [cite(A.MISS_Y, "supporting")])).hypotheses[0])).toEqual([1, 0]);
    expect(sc((await runDna(C.OR, [cite(A.ZY, "supporting"), cite(A.MISS_Y, "supporting")])).hypotheses[0])).toEqual([2, 0]);
  });
  it("X+not-Y = contradiction", async () => {
    expect(sc((await runDna(C.OR, [cite(A.Z_NOT_Y, "contradicting")])).hypotheses[0])).toEqual([0, 1]);
  });
  it("neither trigger + Y = neither", async () => {
    await neither(C.OR, "Y_ONLY");
  });
});

describe("Y because Z", () => {
  it("Y+Z = support", async () => {
    expect(sc((await runDna(C.MOTIVE, [cite(A.MOTIVE_FULL, "supporting")])).hypotheses[0])).toEqual([1, 0]);
  });
  it("Y without Z = neither (a partial match), under either stance", async () => {
    await neither(C.MOTIVE, "MOTIVE_Y_ONLY");
  });
  it("not-Y contradicts without proving Z", async () => {
    expect(sc((await runDna(C.MOTIVE, [cite(A.MOTIVE_NOT_Y, "contradicting")])).hypotheses[0])).toEqual([0, 1]);
  });
  it("conditional form: X+Y without the motive is neither; X+not-Y contradicts; X+Y+Z supports", async () => {
    expect((await runDna(C.COND_MOTIVE, [cite(A.ZY, "supporting")])).hypotheses).toEqual([]);
    expect(sc((await runDna(C.COND_MOTIVE, [cite(A.Z_NOT_Y, "contradicting")])).hypotheses[0])).toEqual([0, 1]);
    expect(sc((await runDna(C.COND_MOTIVE, [cite(A.COND_FULL, "supporting")])).hypotheses[0])).toEqual([1, 0]);
  });
});

describe("role by wording, scope, and partial matches", () => {
  it("ambiguous component fails closed: the belief worded inside 'as long as' is required, never dropped", async () => {
    await neither(C.CALL8, "CALL8_CITATION");
  });
  it("emphasis is not a precondition: the base proposition is supported without 'especially when ...'", async () => {
    expect(sc((await runDna(C.SCOPE, [cite(A.AVOID_LEVERAGE, "supporting")])).hypotheses[0])).toEqual([1, 0]);
  });
  it("the component list no longer names a contrast as a component of its own", () => {
    expect(AFFIRMATIVE_STANCE_RULES).toContain("its precondition(s), its behavior, and any motive, basis or manner it asserts.");
    expect(AFFIRMATIVE_STANCE_RULES).not.toContain("manner or contrast it asserts");
    expect(CLAIM_ATOMICITY_RULES).toContain("an independent property a contrast asserts");
  });
  it("a partial match is never evidence for the whole claim: S=0 and C=0, the claim is dropped, the threshold input is untouched", async () => {
    const out = await runDna(C.CALL13, [cite(A.CALL13_CITATION, "supporting")]);
    expect(out.hypotheses).toEqual([]);
    expect(out.droppedHypotheses).toEqual([C.CALL13]);
    expect(calculateEvidenceStrength(0, 0)).toBe("insufficient_evidence");
  });
});

describe("proposer atomicity through the pipeline (OD-V32-6)", () => {
  it("ALLOWED: one behavior with several legitimate triggers gathers evidence from each branch", async () => {
    const out = await runDna(C.OR, [cite(A.ZY, "supporting"), cite(A.MISS_Y, "supporting"), cite(A.Z_NOT_Y, "contradicting")]);
    expect(sc(out.hypotheses[0])).toEqual([2, 1]);
    expect(out.excluded).toEqual([]);
  });
  it("NOT ONE CLAIM: two separable tendencies joined into one principle gather no evidence from statements that each show one of them", async () => {
    const out = await runStrategy(C.BUNDLED, [cite(A.BELIEF_HOLD, "supporting"), cite(A.PARTIAL_PROFIT, "supporting")]);
    expect(out.principles).toEqual([]);
    expect(out.droppedPrinciples).toEqual([C.BUNDLED]);
    expect(out.excluded.map((e) => e.statementId)).toEqual([A.BELIEF_HOLD, A.PARTIAL_PROFIT]);
  });
});

describe("real-case regression fixtures (sanitized, deterministic)", () => {
  it("7c3665ca / call 8: the citation cannot contradict the whole claim — the belief component is not established by investor evidence", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await runDna(C.CALL8, [cite(A.CALL8_SUPPORT, "supporting"), cite(A.CALL8_CITATION, "contradicting")], log);
    expect(sc(out.hypotheses[0])).toEqual([1, 0]);
    expect(out.excluded).toEqual([{ statement: C.CALL8, statementId: A.CALL8_CITATION, stance: "contradicting", reason: expect.stringContaining("partial match or missing component") }]);
    // the question reached the gate as context and resolved the action (the sale), yet could not fill the belief
    const call = log.find((l) => l.sourceAnswerText === T.CALL8_CITATION)!;
    expect(call.contextText).toBe(Q.CALL8);
    expect(call.stance).toBe("contradicting"); // never flipped
    // an affirmative counter-instance with BOTH conditions still contradicts
    expect(sc((await runDna(C.CALL8, [cite(A.CALL8_COUNTER, "contradicting")])).hypotheses[0])).toEqual([0, 1]);
  });

  it("3653aeed / call 13: belief-driven holding with no exit rule does not support the whole momentum-duration principle", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await runStrategy(C.CALL13, [cite(A.CALL13_CITATION, "supporting")], log);
    expect(out.principles).toEqual([]);
    expect(out.excluded).toEqual([{ statement: C.CALL13, statementId: A.CALL13_CITATION, stance: "supporting", reason: expect.stringContaining("partial match or missing component") }]);
    expect(log[0]!.contextText).toBe(Q.CALL13); // the question says what the answer is about (the buy); it adds no momentum
    // a statement that does establish the momentum component supports it
    expect(sc((await runStrategy(C.CALL13, [cite(A.CALL13_SUPPORT, "supporting")])).principles[0])).toEqual([1, 0]);
  });

  it("the same outcome without any question: context never makes a partial match complete, and its absence never invents one", async () => {
    const validated = validateProposedHypotheses([{ statement: C.CALL8, evidence: [cite(A.CALL8_CITATION, "contradicting")] }], resolver);
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await groundValidatedHypotheses(validated, TEXT_BY_ID, resolver, referenceGate(WORLD, log));
    expect(out.hypotheses).toEqual([]);
    expect("contextText" in log[0]!).toBe(false);
  });
});

describe("Strategy parity", () => {
  it("the observed-Strategy path gives the same outcome for the AND cases", async () => {
    const cites = [cite(A.XZY, "supporting"), cite(A.XZ_NOT_Y, "contradicting"), cite(A.XY, "supporting"), cite(A.X_NOT_Y, "contradicting")];
    const s = await runStrategy(C.AND, cites);
    const d = await runDna(C.AND, cites);
    expect(sc(s.principles[0])).toEqual([1, 1]);
    expect(s.excluded.map((e) => e.statementId)).toEqual(d.excluded.map((e) => e.statementId));
  });
});

describe("remediation planners under V3.2", () => {
  // an identity whose latest version already carries check rows from an EARLIER contract (both citations effective)
  const raw = [
    { id: "ev-support", interviewAnswerId: A.CALL8_SUPPORT, stance: "supporting" as const },
    { id: "ev-contra", interviewAnswerId: A.CALL8_CITATION, stance: "contradicting" as const },
  ];
  const already = new Set(["ev-support", "ev-contra"]);

  it("DNA: re-judges every raw citation, a partial match becomes unsupported, a new version is planned; stance, raw rows and cases are preserved", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const plan = await planGroundingRemediation({ currentVersion: { id: "v-old", statementText: C.CALL8 }, rawEvidence: raw, answerTextById: TEXT_BY_ID, independence: resolver, alreadyGroundedEvidenceIds: already, contextTextById: CONTEXT_BY_ID }, referenceGate(WORLD, log));
    expect(log).toHaveLength(2); // existing checks never cause a citation to be skipped
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect(plan.checks.map((c) => [c.evidenceId, c.verdict])).toEqual([["ev-support", "supported"], ["ev-contra", "unsupported"]]);
    expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount, plan.version.evidenceStrength]).toEqual([1, 0, "insufficient_evidence"]);
    expect(plan.version.statementText).toBe(C.CALL8);
    expect(plan.version.independenceBasis.groups).toHaveLength(1); // no case created
    expect(log.map((l) => l.stance)).toEqual(["supporting", "contradicting"]); // no flip
    expect(raw).toEqual([{ id: "ev-support", interviewAnswerId: A.CALL8_SUPPORT, stance: "supporting" }, { id: "ev-contra", interviewAnswerId: A.CALL8_CITATION, stance: "contradicting" }]);
  });

  it("Strategy: same, for the call-13 shape", async () => {
    const rawS = [
      { id: "ev-full", interviewAnswerId: A.CALL13_SUPPORT, stance: "supporting" as const },
      { id: "ev-partial", interviewAnswerId: A.CALL13_CITATION, stance: "supporting" as const },
    ];
    const plan = await planPrincipleGroundingRemediation({ currentVersion: { id: "v-old", statementText: C.CALL13, principleType: "observed" }, rawEvidence: rawS, answerTextById: TEXT_BY_ID, independence: resolver, alreadyGroundedEvidenceIds: new Set(["ev-full", "ev-partial"]), contextTextById: CONTEXT_BY_ID }, referenceGate(WORLD));
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect(plan.checks.map((c) => [c.evidenceId, c.verdict])).toEqual([["ev-full", "supported"], ["ev-partial", "unsupported"]]);
    expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount]).toEqual([1, 0]);
    expect(plan.version.principleType).toBe("observed");
  });

  it("an unchanged effective set stays a no_op: no version is created merely because the contract changed", async () => {
    const plan = await planGroundingRemediation({ currentVersion: { id: "v-old", statementText: C.CALL8 }, rawEvidence: raw, answerTextById: TEXT_BY_ID, independence: resolver, alreadyGroundedEvidenceIds: new Set(["ev-support"]), contextTextById: CONTEXT_BY_ID }, referenceGate(WORLD));
    expect(plan.action).toBe("no_op");
    expect(Object.keys(plan).sort()).toEqual(["action", "judgments"]); // OD-R9: no version, no checks — only what the gate judged, for the audit ledger
  });

  it("a technical failure still writes nothing under V3.2", async () => {
    const gate = async (): Promise<{ verdict: "unsupported"; reason: string; technicalFailure: true }> => ({ verdict: "unsupported", reason: "Grounding check call failed — failing closed.", technicalFailure: true });
    const d = await planGroundingRemediation({ currentVersion: { id: "v-old", statementText: C.CALL8 }, rawEvidence: raw, answerTextById: TEXT_BY_ID, independence: resolver, alreadyGroundedEvidenceIds: already, contextTextById: CONTEXT_BY_ID }, gate);
    const s = await planPrincipleGroundingRemediation({ currentVersion: { id: "v-old", statementText: C.CALL8, principleType: "observed" }, rawEvidence: raw, answerTextById: TEXT_BY_ID, independence: resolver, alreadyGroundedEvidenceIds: already, contextTextById: CONTEXT_BY_ID }, gate);
    for (const plan of [d, s]) expect(plan).toEqual({ action: "technical_failure", failures: [{ evidenceId: "ev-support", reason: "Grounding check call failed — failing closed." }] });
  });

  it("remediation provenance identifies V3.2", () => {
    const p = buildProvenance({ generator: "strategy.remediateGrounding", model: "claude-sonnet-5", promptContracts: [AI_CONTRACTS.evidenceGrounding], sourceTypes: ["interview_answer"], revalidatedVersionId: "v-old", remediationReason: `${STANCE_SEMANTICS_VERSION}: compound claims`, semanticRule: STANCE_SEMANTICS_VERSION, now: new Date("2026-09-27T00:00:00Z") });
    expect(p).toMatchObject({ generator: "strategy.remediateGrounding", model: "claude-sonnet-5", promptContracts: ["evidence-grounding-v3-2-statements"], semanticRule: "grounding-semantics-v3-2", revalidatedVersionId: "v-old", generatedAt: "2026-09-27T00:00:00.000Z" });
  });
});

describe("Learning carry uses the same V3.2 gate, with no weaker path", () => {
  const stmt = (decisionId: string, text: string): DecisionStatement => ({ statementId: dsid(decisionId), decisionId, kind: "reasoning", ticker: "X", decisionType: "BUY", decisionDate: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z"), text });

  it("a partial match is excluded, a complete match is carried, and a decision statement never carries context", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const result = await groundCarryCitations(C.AND, [{ decisionId: D.XZY, stance: "supporting" }, { decisionId: D.XY, stance: "supporting" }, { decisionId: D.XZ_NOT_Y, stance: "contradicting" }, { decisionId: D.X_NOT_Y, stance: "contradicting" }], [stmt(D.XZY, T.XZY), stmt(D.XY, T.XY), stmt(D.XZ_NOT_Y, T.XZ_NOT_Y), stmt(D.X_NOT_Y, T.X_NOT_Y)], referenceGate(WORLD, log));
    expect(result.citations.map((c) => [c.decisionStatement.decisionId, c.stance])).toEqual([[D.XZY, "supporting"], [D.XZ_NOT_Y, "contradicting"]]);
    expect(result.excluded.map((e) => e.decisionId)).toEqual([D.XY, D.X_NOT_Y]);
    expect(log).toHaveLength(4);
    expect(log.every((l) => l.sourceKind === "decision_statement" && !("contextText" in l))).toBe(true);
  });
});
