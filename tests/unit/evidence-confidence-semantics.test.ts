import { describe, expect, it } from "vitest";
import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import { validateProposedHypotheses, type ValidatedHypothesis } from "@/lib/dna/validate-hypotheses";
import { validateProposedObservedPrinciples, type ValidatedObservedPrinciple } from "@/lib/strategy/validate-principles";
import { validateLearningInsightEvidence } from "@/lib/learning/validate-insight-evidence";
import { createIndependenceResolver } from "@/lib/evidence/resolve-independence";
import { fixtureBasis, resolverFromCaseKeys } from "../helpers/independence";
import { resolveHypothesisIdentities } from "@/lib/dna/resolve-hypothesis-identity";
import { resolveObservedPrincipleIdentities } from "@/lib/strategy/resolve-principle-identity";
import { planGroundingRemediation } from "@/lib/dna/remediate-grounding";
import { planPrincipleGroundingRemediation } from "@/lib/strategy/remediate-grounding";

// Evidence-confidence semantics across every PRODUCTION path that computes
// or persists a tier (DNA, Strategy, Learning Insight, both remediation
// planners, both identity/version resolvers). Every assertion runs the real
// production functions — the only injected pieces are the AI-boundary
// callbacks (grounding / identity match), as in the existing suites.
// Zero real AI, zero DB.
//
// The invariant under test (docs/data-model.md §2): the tier is confidence
// in the CLAIM. Holding supporting evidence fixed, adding contradicting
// evidence must never raise it; contradiction still lowers it.
const RANK: Record<EvidenceStrength, number> = { insufficient_evidence: 0, weak: 1, moderate: 2, strong: 3 };

type Stance = "supporting" | "contradicting";

// s supporting + c contradicting citations, each about its OWN independent case.
function citationsFor(s: number, c: number) {
  return [
    ...Array.from({ length: s }, (_, i) => ({ interviewAnswerId: `s${i}`, stance: "supporting" as Stance, description: "d" })),
    ...Array.from({ length: c }, (_, i) => ({ interviewAnswerId: `c${i}`, stance: "contradicting" as Stance, description: "d" })),
  ];
}
const identityKeys = (evidence: { interviewAnswerId: string }[]) =>
  new Map(evidence.map((e) => [e.interviewAnswerId, e.interviewAnswerId]));

// The same S/C through each real validator.
function tiersThroughEveryValidator(s: number, c: number) {
  const evidence = citationsFor(s, c);
  const keys = identityKeys(evidence);
  const dna = validateProposedHypotheses([{ statement: "claim", evidence }], resolverFromCaseKeys(keys))[0];
  const strategy = validateProposedObservedPrinciples([{ statement: "claim", evidence }], resolverFromCaseKeys(keys))[0];
  const learning = validateLearningInsightEvidence(
    {
      statementText: "claim",
      evidence: evidence.map((e) => ({ decisionReviewId: e.interviewAnswerId, stance: e.stance, description: "d" })),
    },
    keys
  );
  return { dna, strategy, learning };
}

describe("H. DNA, Strategy and Learning Insight share identical strength semantics", () => {
  it("every S/C in 0..6 yields the same counts and tier through all three production validators", () => {
    for (let s = 0; s <= 6; s++) {
      for (let c = 0; c <= 6; c++) {
        if (s + c === 0) continue; // a claim with no evidence at all is dropped by every validator
        const { dna, strategy, learning } = tiersThroughEveryValidator(s, c);
        const expected = calculateEvidenceStrength(s, c);
        for (const [name, result] of [["dna", dna], ["strategy", strategy], ["learning", learning]] as const) {
          expect(result?.supportingCount, `${name} S=${s} C=${c}`).toBe(s);
          expect(result?.contradictingCount, `${name} S=${s} C=${c}`).toBe(c);
          expect(result?.evidenceStrength, `${name} S=${s} C=${c}`).toBe(expected);
        }
      }
    }
  });

  it("holding S fixed, adding independent contradicting cases never raises the tier in ANY validator", () => {
    for (let s = 0; s <= 6; s++) {
      for (let c = 1; c <= 8; c++) {
        const before = tiersThroughEveryValidator(s, c - 1);
        const after = tiersThroughEveryValidator(s, c);
        for (const name of ["dna", "strategy", "learning"] as const) {
          if (s + c - 1 === 0) continue;
          expect(
            RANK[after[name]!.evidenceStrength],
            `${name} S=${s}: C ${c - 1} -> ${c}`
          ).toBeLessThanOrEqual(RANK[before[name]!.evidenceStrength]);
        }
      }
    }
  });
});

describe("J. the persisted tier is always RECOMPUTED, never taken from the AI or a stale input", () => {
  it("validators ignore any AI-provided tier/count fields on the proposed item", () => {
    const evidence = citationsFor(2, 1);
    const keys = identityKeys(evidence);
    const withBogusFields = { statement: "claim", evidence, evidenceStrength: "strong", supportingCount: 99, contradictingCount: 0 };

    const dna = validateProposedHypotheses([withBogusFields as never], resolverFromCaseKeys(keys))[0];
    const strategy = validateProposedObservedPrinciples([withBogusFields as never], resolverFromCaseKeys(keys))[0];

    for (const result of [dna, strategy]) {
      expect(result?.supportingCount).toBe(2);
      expect(result?.contradictingCount).toBe(1);
      expect(result?.evidenceStrength).toBe("insufficient_evidence");
    }
  });

  // The exact live scenario: an existing identity with two supporting cases
  // (MRVL#2, SPCX#1) receives a new batch whose only genuinely new case is a
  // CONTRADICTING one (MRVL#1). It used to become "moderate".
  const caseKeys = new Map([
    ["a-mrvl2", "MRVL#2"],
    ["a-spcx", "SPCX#1"],
    ["a-mrvl1", "MRVL#1"],
  ]);
  const existingEvidence = [
    { interviewAnswerId: "a-mrvl2", stance: "supporting" as Stance },
    { interviewAnswerId: "a-spcx", stance: "supporting" as Stance },
  ];
  const batchEvidence = [
    { interviewAnswerId: "a-mrvl2", stance: "supporting" as Stance, description: "already persisted" },
    { interviewAnswerId: "a-mrvl1", stance: "contradicting" as Stance, description: "the new contradicting case" },
  ];
  // Stale/bogus values a previous step (or the AI) might have carried along.
  const staleTier = { supportingCount: 99, contradictingCount: 0, evidenceStrength: "strong" as const, independenceBasis: fixtureBasis(99, 0) };

  it("Strategy: a new version whose only new case is contradicting stays insufficient_evidence (S=2, C=1), with only the new row to insert", async () => {
    const proposed: ValidatedObservedPrinciple = { statement: "You hold on based on belief.", evidence: batchEvidence, ...staleTier };
    const resolutions = await resolveObservedPrincipleIdentities(
      [proposed],
      [{ id: "existing", statementText: "Existing wording.", rejectedEvidence: [], evidenceForCounting: existingEvidence }],
      resolverFromCaseKeys(caseKeys),
      async () => ({ matchedId: "existing", reason: "same claim" })
    );

    const resolution = resolutions[0];
    expect(resolution?.action).toBe("new_version");
    if (resolution?.action !== "new_version") throw new Error("expected new_version");
    expect(resolution.supportingCount).toBe(2);
    expect(resolution.contradictingCount).toBe(1);
    expect(resolution.evidenceStrength).toBe("insufficient_evidence");
    expect(resolution.newEvidence.map((e) => e.interviewAnswerId)).toEqual(["a-mrvl1"]);
  });

  it("DNA: the identical scenario resolves identically", async () => {
    const proposed: ValidatedHypothesis = { statement: "You hold on based on belief.", evidence: batchEvidence, ...staleTier };
    const resolutions = await resolveHypothesisIdentities(
      [proposed],
      [{ id: "existing", statementText: "Existing wording.", rejectedEvidence: [], evidenceForCounting: existingEvidence }],
      resolverFromCaseKeys(caseKeys),
      async () => ({ matchedId: "existing", reason: "same claim" })
    );

    const resolution = resolutions[0];
    expect(resolution?.action).toBe("new_version");
    if (resolution?.action !== "new_version") throw new Error("expected new_version");
    expect(resolution.supportingCount).toBe(2);
    expect(resolution.contradictingCount).toBe(1);
    expect(resolution.evidenceStrength).toBe("insufficient_evidence");
    expect(resolution.newEvidence.map((e) => e.interviewAnswerId)).toEqual(["a-mrvl1"]);
  });

  it("a new identity ignores stale AI/previous-step tier fields and recomputes from its evidence", async () => {
    const evidence = citationsFor(2, 1);
    const keys = identityKeys(evidence);
    const noMatch = async () => ({ matchedId: null, reason: "no match" });

    const strategy = await resolveObservedPrincipleIdentities(
      [{ statement: "x", evidence, ...staleTier }],
      [],
      resolverFromCaseKeys(keys),
      noMatch
    );
    const dna = await resolveHypothesisIdentities([{ statement: "x", evidence, ...staleTier }], [], resolverFromCaseKeys(keys), noMatch);

    for (const resolution of [strategy[0], dna[0]]) {
      expect(resolution?.action).toBe("new_identity");
      if (resolution?.action !== "new_identity") throw new Error("expected new_identity");
      expect(resolution.supportingCount).toBe(2);
      expect(resolution.contradictingCount).toBe(1);
      expect(resolution.evidenceStrength).toBe("insufficient_evidence");
    }
  });
});

describe("I. remediation applies the same semantics as generation", () => {
  const raw = (s: number, c: number) => [
    ...Array.from({ length: s }, (_, i) => ({ id: `ev-s${i}`, interviewAnswerId: `s${i}`, stance: "supporting" as Stance })),
    ...Array.from({ length: c }, (_, i) => ({ id: `ev-c${i}`, interviewAnswerId: `c${i}`, stance: "contradicting" as Stance })),
  ];
  const textAndKeys = (rawEvidence: { interviewAnswerId: string }[]) => ({
    answerTextById: new Map(rawEvidence.map((e) => [e.interviewAnswerId, `text ${e.interviewAnswerId}`])),
    independence: resolverFromCaseKeys(new Map(rawEvidence.map((e) => [e.interviewAnswerId, e.interviewAnswerId]))),
  });
  const rejecting = (rejectedTexts: string[]) => async (input: { sourceAnswerText: string }) =>
    rejectedTexts.includes(input.sourceAnswerText)
      ? { verdict: "unsupported" as const, reason: "does not establish the claim" }
      : { verdict: "supported" as const, reason: "matches" };

  async function bothPlans(rawEvidence: ReturnType<typeof raw>, rejectedTexts: string[]) {
    const common = { rawEvidence, ...textAndKeys(rawEvidence), alreadyGroundedEvidenceIds: null };
    const dna = await planGroundingRemediation(
      { ...common, currentVersion: { id: "v1", statementText: "claim" } },
      rejecting(rejectedTexts)
    );
    const strategy = await planPrincipleGroundingRemediation(
      { ...common, currentVersion: { id: "v1", statementText: "claim", principleType: "observed" } },
      rejecting(rejectedTexts)
    );
    return { dna, strategy };
  }

  it("rejecting one of 3 supporting citations leaves S=2 with a contradicting case: insufficient_evidence in BOTH planners (used to be moderate)", async () => {
    const { dna, strategy } = await bothPlans(raw(3, 1), ["text s2"]);
    for (const plan of [dna, strategy]) {
      expect(plan.action).toBe("new_version");
      if (plan.action !== "new_version") throw new Error("expected new_version");
      expect(plan.version.supportingEvidenceCount).toBe(2);
      expect(plan.version.contradictingEvidenceCount).toBe(1);
      expect(plan.version.evidenceStrength).toBe("insufficient_evidence");
    }
  });

  it("rejecting a CONTRADICTING citation can only relax the ratio: (4,2) -> (4,1) is capped at moderate by the 4 supporting cases, never strong", async () => {
    const { dna, strategy } = await bothPlans(raw(4, 2), ["text c1"]);
    for (const plan of [dna, strategy]) {
      expect(plan.action).toBe("new_version");
      if (plan.action !== "new_version") throw new Error("expected new_version");
      expect(plan.version.supportingEvidenceCount).toBe(4);
      expect(plan.version.contradictingEvidenceCount).toBe(1);
      expect(plan.version.evidenceStrength).toBe("moderate");
      expect(plan.version.evidenceStrength).toBe(calculateEvidenceStrength(4, 1));
    }
  });
});

describe("F/G. independent-case counting still drives S and C", () => {
  // MP#1 covers three separate answers about one open-to-flat position.
  const episodeKeyByTransactionId = new Map([
    ["tx-1", "MP#1"],
    ["tx-2", "MP#1"],
    ["tx-3", "MP#1"],
    ["tx-9", "MRVL#1"],
  ]);
  const answers = [
    { id: "a1", transactionId: "tx-1" },
    { id: "a2", transactionId: "tx-2" },
    { id: "a3", transactionId: "tx-3" },
    { id: "a9", transactionId: "tx-9" },
    { id: "a10", transactionId: null },
  ];
  const resolverFor = (extraAnswers: { id: string; transactionId: string | null }[] = [], extraEpisodes: [string, string][] = []) =>
    createIndependenceResolver({
      episodeKeyByTransactionId: new Map([...episodeKeyByTransactionId, ...extraEpisodes]),
      transactions: [],
      answers: [...answers, ...extraAnswers].map((a) => ({ ...a, answerText: "" })),
      facts: [],
    });
  const independence = resolverFor();
  const cite = (id: string, stance: Stance) => ({ interviewAnswerId: id, stance, description: "d" });
  const strategyOf = (evidence: ReturnType<typeof cite>[]) =>
    validateProposedObservedPrinciples([{ statement: "claim", evidence }], independence)[0];

  it("F. many answers from ONE investment episode count once on their side — they cannot inflate S or C", () => {
    const oneCaseFiveTimes = strategyOf([cite("a1", "supporting"), cite("a2", "supporting"), cite("a3", "supporting")]);
    expect(oneCaseFiveTimes?.supportingCount).toBe(1);
    expect(oneCaseFiveTimes?.evidenceStrength).toBe("insufficient_evidence");

    const oneEpisodeContradicting = strategyOf([cite("a9", "supporting"), cite("a1", "contradicting"), cite("a2", "contradicting")]);
    expect(oneEpisodeContradicting?.supportingCount).toBe(1);
    expect(oneEpisodeContradicting?.contradictingCount).toBe(1);
  });

  it("G. supporting and contradicting evidence from separate cases are each counted once and tiered correctly", () => {
    const liveShape = strategyOf([cite("a1", "supporting"), cite("a9", "supporting"), cite("a10", "contradicting")]);
    expect(liveShape?.supportingCount).toBe(2);
    expect(liveShape?.contradictingCount).toBe(1);
    expect(liveShape?.evidenceStrength).toBe("insufficient_evidence");

    // Two extra genuinely independent supporting cases DO raise it.
    const moreSupport = validateProposedObservedPrinciples(
      [{ statement: "claim", evidence: [cite("a1", "supporting"), cite("a9", "supporting"), cite("a10", "supporting"), cite("x1", "contradicting")] }],
      resolverFor([{ id: "x1", transactionId: "tx-x1" }], [["tx-x1", "X#1"]])
    )[0];
    expect(moreSupport?.supportingCount).toBe(3);
    expect(moreSupport?.contradictingCount).toBe(1);
    expect(moreSupport?.evidenceStrength).toBe("moderate");
  });

  it("a case cited with disagreeing stances counts as contradicting, and that disagreement cannot lift the tier", () => {
    const result = strategyOf([
      cite("a1", "supporting"),
      cite("a9", "supporting"),
      cite("a10", "supporting"),
      cite("a1", "contradicting"), // MP#1 now disagrees with itself -> contradicting
    ]);
    expect(result?.supportingCount).toBe(2);
    expect(result?.contradictingCount).toBe(1);
    expect(result?.evidenceStrength).toBe("insufficient_evidence"); // 3 supporting -> would have been moderate before the disagreement
  });
});
