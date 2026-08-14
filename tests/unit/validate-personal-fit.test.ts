import { describe, expect, it } from "vitest";
import { validatePersonalFit } from "@/lib/case/validate-personal-fit";
import type { ProposedPersonalFit } from "@/lib/ai/case";

describe("validatePersonalFit", () => {
  it("keeps citations that resolve to real ids and reports traceable evidence", () => {
    const proposed: ProposedPersonalFit = {
      personalFitText: "This aligns with your tendency to buy after pullbacks.",
      citedDnaHypothesisIds: ["dna-1"],
      citedStrategyPrincipleIds: [],
    };
    const result = validatePersonalFit(proposed, new Set(["dna-1"]), new Set());
    expect(result.citedDnaHypothesisIds).toEqual(["dna-1"]);
    expect(result.hasTraceableEvidence).toBe(true);
  });

  it("drops hallucinated ids but keeps the narrative text", () => {
    const proposed: ProposedPersonalFit = {
      personalFitText: "Some assessment.",
      citedDnaHypothesisIds: ["made-up-id"],
      citedStrategyPrincipleIds: ["also-fake"],
    };
    const result = validatePersonalFit(proposed, new Set(["real-dna-1"]), new Set(["real-strategy-1"]));
    expect(result.citedDnaHypothesisIds).toEqual([]);
    expect(result.citedStrategyPrincipleIds).toEqual([]);
    expect(result.personalFitText).toBe("Some assessment.");
    expect(result.hasTraceableEvidence).toBe(false);
  });

  it("reports no traceable evidence for a legitimate 'not enough history yet' result", () => {
    const proposed: ProposedPersonalFit = {
      personalFitText: "There isn't enough personal history yet to assess fit.",
      citedDnaHypothesisIds: [],
      citedStrategyPrincipleIds: [],
    };
    const result = validatePersonalFit(proposed, new Set(), new Set());
    expect(result.hasTraceableEvidence).toBe(false);
  });

  it("keeps valid citations from a mix of valid and invalid ones", () => {
    const proposed: ProposedPersonalFit = {
      personalFitText: "Mixed grounding.",
      citedDnaHypothesisIds: ["dna-1", "dna-fake"],
      citedStrategyPrincipleIds: ["strategy-1"],
    };
    const result = validatePersonalFit(
      proposed,
      new Set(["dna-1"]),
      new Set(["strategy-1"])
    );
    expect(result.citedDnaHypothesisIds).toEqual(["dna-1"]);
    expect(result.citedStrategyPrincipleIds).toEqual(["strategy-1"]);
    expect(result.hasTraceableEvidence).toBe(true);
  });
});
