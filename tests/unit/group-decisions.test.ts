import { describe, expect, it } from "vitest";
import { groupReviewedDecisionsBySector, type ReviewedDecisionInput } from "@/lib/learning/group-decisions";

function decision(overrides: Partial<ReviewedDecisionInput> & { decisionId: string }): ReviewedDecisionInput {
  return {
    decisionReviewId: `review-${overrides.decisionId}`,
    ticker: "TICK",
    sector: "Technology",
    ...overrides,
  };
}

describe("groupReviewedDecisionsBySector", () => {
  it("groups decisions that share a real sector", () => {
    const families = groupReviewedDecisionsBySector([
      decision({ decisionId: "1", sector: "Technology" }),
      decision({ decisionId: "2", sector: "Technology" }),
    ]);
    expect(families).toHaveLength(1);
    expect(families[0]?.family).toBe("Technology");
    expect(families[0]?.decisions).toHaveLength(2);
  });

  it("excludes a family below the minimum size", () => {
    const families = groupReviewedDecisionsBySector([decision({ decisionId: "1", sector: "Energy" })]);
    expect(families).toHaveLength(0);
  });

  it("skips decisions with no recorded sector rather than inventing an 'Unknown' family", () => {
    const families = groupReviewedDecisionsBySector([
      decision({ decisionId: "1", sector: null }),
      decision({ decisionId: "2", sector: null }),
      decision({ decisionId: "3", sector: "  " }),
    ]);
    expect(families).toHaveLength(0);
  });

  it("keeps multiple distinct sector families separate", () => {
    const families = groupReviewedDecisionsBySector([
      decision({ decisionId: "1", sector: "Technology" }),
      decision({ decisionId: "2", sector: "Technology" }),
      decision({ decisionId: "3", sector: "Healthcare" }),
      decision({ decisionId: "4", sector: "Healthcare" }),
    ]);
    expect(families.map((f) => f.family).sort()).toEqual(["Healthcare", "Technology"]);
  });

  it("returns an empty list for no decisions", () => {
    expect(groupReviewedDecisionsBySector([])).toEqual([]);
  });
});
