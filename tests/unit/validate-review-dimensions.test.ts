import { describe, expect, it } from "vitest";
import { validateReviewDimensions, type ProposedReviewDimension } from "@/lib/review/validate-review-dimensions";

const ALL_SEVEN = [
  "thesis_quality",
  "evidence_quality",
  "risk_awareness",
  "valuation_awareness",
  "portfolio_fit",
  "strategy_consistency",
  "exit_conditions",
] as const;

function fullProposal(overrides: Partial<Record<string, Partial<ProposedReviewDimension>>> = {}): ProposedReviewDimension[] {
  return ALL_SEVEN.map((dimension) => ({
    dimension,
    verdict: "reasonable",
    rationaleText: "Some rationale.",
    citedSnapshotFields: ["userReasoningText"],
    ...overrides[dimension],
  }));
}

describe("validateReviewDimensions", () => {
  it("always returns exactly the 7 required dimensions", () => {
    const result = validateReviewDimensions(fullProposal());
    expect(result).toHaveLength(7);
    expect(result.map((r) => r.dimension).sort()).toEqual([...ALL_SEVEN].sort());
  });

  it("keeps a verdict whose citations resolve to real citable fields", () => {
    const result = validateReviewDimensions(
      fullProposal({ thesis_quality: { citedSnapshotFields: ["userReasoningText", "thesisInterpretationText"] } })
    );
    const dim = result.find((r) => r.dimension === "thesis_quality")!;
    expect(dim.verdict).toBe("reasonable");
    expect(dim.citedSnapshotFields).toEqual(["userReasoningText", "thesisInterpretationText"]);
  });

  it("drops a citation to a field that isn't a real citable field", () => {
    const result = validateReviewDimensions(
      fullProposal({ risk_awareness: { citedSnapshotFields: ["risksConsideredText", "madeUpField"] } })
    );
    const dim = result.find((r) => r.dimension === "risk_awareness")!;
    expect(dim.citedSnapshotFields).toEqual(["risksConsideredText"]);
  });

  it("downgrades a non-insufficient verdict to insufficient_evidence when every citation was invalid", () => {
    const result = validateReviewDimensions(
      fullProposal({ valuation_awareness: { verdict: "strong", citedSnapshotFields: ["totallyFake"] } })
    );
    const dim = result.find((r) => r.dimension === "valuation_awareness")!;
    expect(dim.verdict).toBe("insufficient_evidence");
    expect(dim.citedSnapshotFields).toEqual([]);
  });

  it("leaves an honest insufficient_evidence verdict with zero citations alone (that's the valid, expected shape)", () => {
    const result = validateReviewDimensions(
      fullProposal({
        exit_conditions: { verdict: "insufficient_evidence", citedSnapshotFields: [] },
      })
    );
    const dim = result.find((r) => r.dimension === "exit_conditions")!;
    expect(dim.verdict).toBe("insufficient_evidence");
  });

  it("fills in a missing dimension as insufficient_evidence rather than dropping it", () => {
    const proposed = fullProposal().filter((p) => p.dimension !== "strategy_consistency");
    const result = validateReviewDimensions(proposed);
    const dim = result.find((r) => r.dimension === "strategy_consistency")!;
    expect(dim.verdict).toBe("insufficient_evidence");
    expect(dim.citedSnapshotFields).toEqual([]);
    expect(result).toHaveLength(7);
  });

  it("returns all insufficient_evidence for a completely empty proposal", () => {
    const result = validateReviewDimensions([]);
    expect(result).toHaveLength(7);
    expect(result.every((r) => r.verdict === "insufficient_evidence")).toBe(true);
  });
});
