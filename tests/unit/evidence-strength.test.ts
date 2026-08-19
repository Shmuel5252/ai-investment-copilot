import { describe, expect, it } from "vitest";
import { calculateEvidenceStrength, excludeInsufficientEvidence } from "@/lib/dna/evidence-strength";

// Table from docs/data-model.md §2:
// total<3 -> insufficient_evidence; S/total<0.6 -> weak;
// total>=5 && S/total>=0.8 -> strong; else -> moderate.
describe("calculateEvidenceStrength", () => {
  it("returns insufficient_evidence when total evidence is under 3", () => {
    expect(calculateEvidenceStrength(0, 0)).toBe("insufficient_evidence");
    expect(calculateEvidenceStrength(2, 0)).toBe("insufficient_evidence");
    expect(calculateEvidenceStrength(1, 1)).toBe("insufficient_evidence");
  });

  it("returns weak when supporting ratio is below 0.6", () => {
    expect(calculateEvidenceStrength(1, 2)).toBe("weak"); // 3 total, ratio 0.33
    expect(calculateEvidenceStrength(2, 3)).toBe("weak"); // 5 total, ratio 0.4
  });

  it("returns strong only at total>=5 AND ratio>=0.8", () => {
    expect(calculateEvidenceStrength(4, 1)).toBe("strong"); // 5 total, ratio 0.8
    expect(calculateEvidenceStrength(8, 1)).toBe("strong"); // 9 total, ratio 0.89
  });

  it("returns moderate when ratio>=0.6 but strong's conditions aren't met", () => {
    expect(calculateEvidenceStrength(2, 1)).toBe("moderate"); // 3 total, ratio 0.67 (<5 total)
    expect(calculateEvidenceStrength(3, 1)).toBe("moderate"); // 4 total, ratio 0.75 (<5 total)
    expect(calculateEvidenceStrength(3, 2)).toBe("moderate"); // 5 total, ratio 0.6 (<0.8 ratio)
  });

  it("is based on ratio, not raw counts alone (10 vs 0 vs 3 vs 0 both strong)", () => {
    expect(calculateEvidenceStrength(3, 0)).toBe("moderate"); // 3 total: below the total>=5 bar for strong
    expect(calculateEvidenceStrength(5, 0)).toBe("strong");
  });

  it("treats a majority-contradicting hypothesis as weak, not just low-confidence", () => {
    expect(calculateEvidenceStrength(1, 4)).toBe("weak");
  });
});

// Regression coverage for a real gap the user found: insufficient_evidence
// items must never participate in narrative-shaping AI reasoning, hedged
// or not — enforced by removing them from context entirely, not by
// trusting a prompt instruction.
describe("excludeInsufficientEvidence", () => {
  it("drops items whose evidenceStrength is insufficient_evidence", () => {
    const items = [
      { id: "a", evidenceStrength: "insufficient_evidence" as const },
      { id: "b", evidenceStrength: "weak" as const },
      { id: "c", evidenceStrength: "moderate" as const },
      { id: "d", evidenceStrength: "strong" as const },
    ];
    expect(excludeInsufficientEvidence(items).map((i) => i.id)).toEqual(["b", "c", "d"]);
  });

  it("keeps weak items — a real, if shaky, observed pattern, unlike insufficient_evidence", () => {
    const items = [{ id: "a", evidenceStrength: "weak" as const }];
    expect(excludeInsufficientEvidence(items)).toHaveLength(1);
  });

  it("keeps items with null evidenceStrength (e.g. declared/validated Strategy principles, which don't carry a strength at all)", () => {
    const items = [{ id: "a", evidenceStrength: null }];
    expect(excludeInsufficientEvidence(items)).toHaveLength(1);
  });

  it("returns an empty list unchanged", () => {
    expect(excludeInsufficientEvidence([])).toEqual([]);
  });
});
