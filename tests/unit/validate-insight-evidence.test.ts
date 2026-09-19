import { describe, expect, it } from "vitest";
import { validateLearningInsightEvidence } from "@/lib/learning/validate-insight-evidence";
import type { ProposedLearningInsight } from "@/lib/ai/learning";

// Each review id is its own independent case (id -> id) unless a test
// explicitly wants two reviews to resolve to the same underlying decision.
function identityCaseKeys(ids: string[]): Map<string, string> {
  return new Map(ids.map((id) => [id, id]));
}

describe("validateLearningInsightEvidence", () => {
  it("keeps an insight whose evidence all cites real review ids", () => {
    const caseKeys = identityCaseKeys(["r1", "r2"]);
    const proposed: ProposedLearningInsight = {
      statementText: "Your Technology-sector decisions tend to have well-defined exit conditions.",
      evidence: [
        { decisionReviewId: "r1", stance: "supporting", description: "Clear exit trigger recorded." },
        { decisionReviewId: "r2", stance: "supporting", description: "Clear exit trigger recorded too." },
      ],
    };
    const result = validateLearningInsightEvidence(proposed, caseKeys);
    expect(result).not.toBeNull();
    expect(result!.supportingCount).toBe(2);
    expect(result!.contradictingCount).toBe(0);
    expect(result!.evidenceStrength).toBe("insufficient_evidence"); // only 2 pieces of evidence
  });

  it("drops individual citations that reference a hallucinated review id", () => {
    const caseKeys = identityCaseKeys(["r1"]);
    const proposed: ProposedLearningInsight = {
      statementText: "Pattern statement.",
      evidence: [
        { decisionReviewId: "r1", stance: "supporting", description: "Real citation." },
        { decisionReviewId: "made-up-id", stance: "supporting", description: "Hallucinated." },
      ],
    };
    const result = validateLearningInsightEvidence(proposed, caseKeys);
    expect(result!.evidence).toHaveLength(1);
    expect(result!.evidence[0]?.decisionReviewId).toBe("r1");
  });

  it("returns null (not a thin insight, not an insight) when every citation is invalid", () => {
    const caseKeys = identityCaseKeys(["r1"]);
    const proposed: ProposedLearningInsight = {
      statementText: "No real evidence behind this.",
      evidence: [{ decisionReviewId: "fake", stance: "supporting", description: "Not real." }],
    };
    expect(validateLearningInsightEvidence(proposed, caseKeys)).toBeNull();
  });

  it("preserves an honest contradicting citation rather than dropping it", () => {
    const caseKeys = identityCaseKeys(["r1", "r2", "r3"]);
    const proposed: ProposedLearningInsight = {
      statementText: "Mostly a strong pattern, with one exception.",
      evidence: [
        { decisionReviewId: "r1", stance: "supporting", description: "x" },
        { decisionReviewId: "r2", stance: "supporting", description: "x" },
        { decisionReviewId: "r3", stance: "contradicting", description: "This one broke the pattern." },
      ],
    };
    const result = validateLearningInsightEvidence(proposed, caseKeys);
    expect(result!.contradictingCount).toBe(1);
    // 2 supporting + 1 contradicting: the contradiction is kept and counted,
    // but it can't lift 2 supporting cases out of insufficient_evidence.
    expect(result!.evidenceStrength).toBe("insufficient_evidence");
  });

  it("returns null for an empty statement", () => {
    const caseKeys = identityCaseKeys(["r1"]);
    const proposed = {
      statementText: "",
      evidence: [{ decisionReviewId: "r1", stance: "supporting", description: "x" }],
    } as ProposedLearningInsight;
    expect(validateLearningInsightEvidence(proposed, caseKeys)).toBeNull();
  });

  // Regression coverage: two DecisionReviews of the *same* Decision (a
  // decision re-reviewed later, e.g. at 3mo and 12mo) must count as one
  // independent case, not two, even though listReviewedDecisionsForInvestor
  // already prevents this from happening in practice today — the counting
  // itself should be correct by construction, not by an incidental
  // property of a different function.
  it("counts two reviews of the same decision as one independent case, not two", () => {
    const caseKeys = new Map([
      ["r1", "decision-A"],
      ["r2", "decision-A"], // a later re-review of the same decision
      ["r3", "decision-B"],
    ]);
    const proposed: ProposedLearningInsight = {
      statementText: "Pattern across a family.",
      evidence: [
        { decisionReviewId: "r1", stance: "supporting", description: "First review." },
        { decisionReviewId: "r2", stance: "supporting", description: "Re-review of the same decision." },
        { decisionReviewId: "r3", stance: "supporting", description: "A genuinely different decision." },
      ],
    };
    const result = validateLearningInsightEvidence(proposed, caseKeys);
    expect(result!.evidence).toHaveLength(3);
    expect(result!.supportingCount).toBe(2);
  });
});
