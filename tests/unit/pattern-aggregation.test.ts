import { describe, expect, it } from "vitest";
import { computeDecisionQualityPattern, computeThesisAccuracyPattern } from "@/lib/learning/pattern-aggregation";

describe("computeDecisionQualityPattern", () => {
  it("tallies each decision quality value seen", () => {
    const pattern = computeDecisionQualityPattern([
      { decisionQualityOverall: "strong" },
      { decisionQualityOverall: "strong" },
      { decisionQualityOverall: "weak" },
    ]);
    expect(pattern).toEqual({ insufficient_evidence: 0, weak: 1, reasonable: 0, strong: 2 });
  });

  it("returns all-zero counts for an empty list", () => {
    expect(computeDecisionQualityPattern([])).toEqual({
      insufficient_evidence: 0,
      weak: 0,
      reasonable: 0,
      strong: 0,
    });
  });
});

describe("computeThesisAccuracyPattern", () => {
  it("tallies each thesis accuracy value seen", () => {
    const pattern = computeThesisAccuracyPattern([
      { thesisAccuracy: "confirmed" },
      { thesisAccuracy: "refuted" },
      { thesisAccuracy: "confirmed" },
      { thesisAccuracy: "insufficient_evidence" },
    ]);
    expect(pattern).toEqual({
      confirmed: 2,
      partially_confirmed: 0,
      refuted: 1,
      inconclusive: 0,
      insufficient_evidence: 1,
    });
  });

  it("returns all-zero counts for an empty list", () => {
    expect(computeThesisAccuracyPattern([])).toEqual({
      confirmed: 0,
      partially_confirmed: 0,
      refuted: 0,
      inconclusive: 0,
      insufficient_evidence: 0,
    });
  });
});
