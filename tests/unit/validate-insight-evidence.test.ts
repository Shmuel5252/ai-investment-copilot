import { describe, expect, it } from "vitest";
import { validateLearningInsightEvidence } from "@/lib/learning/validate-insight-evidence";
import type { ProposedLearningInsight } from "@/lib/ai/learning";

describe("validateLearningInsightEvidence", () => {
  it("keeps an insight whose evidence all cites real review ids", () => {
    const validIds = new Set(["r1", "r2"]);
    const proposed: ProposedLearningInsight = {
      statementText: "Your Technology-sector decisions tend to have well-defined exit conditions.",
      evidence: [
        { decisionReviewId: "r1", stance: "supporting", description: "Clear exit trigger recorded." },
        { decisionReviewId: "r2", stance: "supporting", description: "Clear exit trigger recorded too." },
      ],
    };
    const result = validateLearningInsightEvidence(proposed, validIds);
    expect(result).not.toBeNull();
    expect(result!.supportingCount).toBe(2);
    expect(result!.contradictingCount).toBe(0);
    expect(result!.evidenceStrength).toBe("insufficient_evidence"); // only 2 pieces of evidence
  });

  it("drops individual citations that reference a hallucinated review id", () => {
    const validIds = new Set(["r1"]);
    const proposed: ProposedLearningInsight = {
      statementText: "Pattern statement.",
      evidence: [
        { decisionReviewId: "r1", stance: "supporting", description: "Real citation." },
        { decisionReviewId: "made-up-id", stance: "supporting", description: "Hallucinated." },
      ],
    };
    const result = validateLearningInsightEvidence(proposed, validIds);
    expect(result!.evidence).toHaveLength(1);
    expect(result!.evidence[0]?.decisionReviewId).toBe("r1");
  });

  it("returns null (not a thin insight, not an insight) when every citation is invalid", () => {
    const validIds = new Set(["r1"]);
    const proposed: ProposedLearningInsight = {
      statementText: "No real evidence behind this.",
      evidence: [{ decisionReviewId: "fake", stance: "supporting", description: "Not real." }],
    };
    expect(validateLearningInsightEvidence(proposed, validIds)).toBeNull();
  });

  it("preserves an honest contradicting citation rather than dropping it", () => {
    const validIds = new Set(["r1", "r2", "r3"]);
    const proposed: ProposedLearningInsight = {
      statementText: "Mostly a strong pattern, with one exception.",
      evidence: [
        { decisionReviewId: "r1", stance: "supporting", description: "x" },
        { decisionReviewId: "r2", stance: "supporting", description: "x" },
        { decisionReviewId: "r3", stance: "contradicting", description: "This one broke the pattern." },
      ],
    };
    const result = validateLearningInsightEvidence(proposed, validIds);
    expect(result!.contradictingCount).toBe(1);
    expect(result!.evidenceStrength).toBe("moderate"); // 3 total, ratio 0.67
  });

  it("returns null for an empty statement", () => {
    const validIds = new Set(["r1"]);
    const proposed = {
      statementText: "",
      evidence: [{ decisionReviewId: "r1", stance: "supporting", description: "x" }],
    } as ProposedLearningInsight;
    expect(validateLearningInsightEvidence(proposed, validIds)).toBeNull();
  });
});
