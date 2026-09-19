import { describe, expect, it } from "vitest";
import {
  calculateEvidenceStrength,
  excludeInsufficientEvidence,
  type EvidenceStrength,
} from "@/lib/dna/evidence-strength";

// Table from docs/data-model.md §2 (S = supporting independent cases,
// C = contradicting independent cases). The tier is CONFIDENCE IN THE
// CLAIM, so the sample-size gates count SUPPORTING cases only:
//   S < 3                       -> insufficient_evidence
//   S/(S+C) < 0.6               -> weak
//   S >= 5 && S/(S+C) >= 0.8    -> strong
//   otherwise                   -> moderate
// Everything here runs the REAL production function — no reimplementation.
const RANK: Record<EvidenceStrength, number> = {
  insufficient_evidence: 0,
  weak: 1,
  moderate: 2,
  strong: 3,
};
const rank = (s: number, c: number) => RANK[calculateEvidenceStrength(s, c)];
const GRID = 25;

describe("calculateEvidenceStrength", () => {
  it("returns insufficient_evidence with fewer than 3 SUPPORTING cases, whatever the contradiction count", () => {
    for (const [s, c] of [
      [0, 0],
      [2, 0],
      [1, 1],
      [2, 1], // the live regression: used to be moderate
      [0, 3],
      [1, 3],
      [2, 2],
      [2, 5],
    ] as const) {
      expect(calculateEvidenceStrength(s, c)).toBe("insufficient_evidence");
    }
  });

  it("returns weak once support is sufficient (>=3) but the supporting ratio is below 0.6", () => {
    expect(calculateEvidenceStrength(3, 3)).toBe("weak"); // ratio 0.5
    expect(calculateEvidenceStrength(3, 5)).toBe("weak");
    expect(calculateEvidenceStrength(5, 5)).toBe("weak");
    expect(calculateEvidenceStrength(3, 20)).toBe("weak");
  });

  it("returns strong only at >=5 SUPPORTING cases AND ratio>=0.8", () => {
    expect(calculateEvidenceStrength(5, 0)).toBe("strong");
    expect(calculateEvidenceStrength(5, 1)).toBe("strong"); // ratio 0.83
    expect(calculateEvidenceStrength(8, 1)).toBe("strong");
    expect(calculateEvidenceStrength(20, 4)).toBe("strong");
    // 4 supporting + 1 contradicting used to be "strong" (total 5, ratio 0.8):
    // a contradiction lifting moderate (4,0) to strong.
    expect(calculateEvidenceStrength(4, 1)).toBe("moderate");
  });

  it("returns moderate when support is sufficient and ratio>=0.6 but strong's conditions aren't met", () => {
    expect(calculateEvidenceStrength(3, 0)).toBe("moderate");
    expect(calculateEvidenceStrength(3, 1)).toBe("moderate"); // ratio 0.75
    expect(calculateEvidenceStrength(3, 2)).toBe("moderate"); // ratio 0.6
    expect(calculateEvidenceStrength(4, 0)).toBe("moderate");
    expect(calculateEvidenceStrength(5, 3)).toBe("moderate"); // ratio 0.625
  });

  it("is based on ratio AND supporting volume, not raw counts alone", () => {
    expect(calculateEvidenceStrength(3, 0)).toBe("moderate"); // 3 supporting: below the S>=5 bar for strong
    expect(calculateEvidenceStrength(5, 0)).toBe("strong");
  });
});

describe("truth table — previous tier -> new tier", () => {
  // `before` is the pre-fix tier, kept for review; only `after` is asserted.
  it.each([
    [0, 0, "insufficient_evidence", "insufficient_evidence"],
    [0, 1, "insufficient_evidence", "insufficient_evidence"],
    [0, 3, "weak", "insufficient_evidence"],
    [1, 0, "insufficient_evidence", "insufficient_evidence"],
    [1, 1, "insufficient_evidence", "insufficient_evidence"],
    [1, 3, "weak", "insufficient_evidence"],
    [2, 0, "insufficient_evidence", "insufficient_evidence"],
    [2, 1, "moderate", "insufficient_evidence"],
    [2, 2, "weak", "insufficient_evidence"],
    [2, 5, "weak", "insufficient_evidence"],
    [3, 0, "moderate", "moderate"],
    [3, 1, "moderate", "moderate"],
    [3, 3, "weak", "weak"],
    [3, 5, "weak", "weak"],
    [4, 1, "strong", "moderate"],
    [5, 0, "strong", "strong"],
    [5, 1, "strong", "strong"],
    [5, 3, "moderate", "moderate"],
    [5, 5, "weak", "weak"],
  ] as const)("S=%i C=%i: was %s -> %s", (s, c, _before, after) => {
    expect(calculateEvidenceStrength(s, c)).toBe(after);
  });
});

describe("monotonicity invariant — uncertainty must never increase confidence", () => {
  it("A. contradiction-only evidence never creates confidence", () => {
    for (let c = 0; c <= 50; c++) {
      expect(calculateEvidenceStrength(0, c)).toBe("insufficient_evidence");
    }
  });

  it("B. holding S fixed, adding contradicting cases NEVER raises the tier (every S,C in 0..25)", () => {
    for (let s = 0; s <= GRID; s++) {
      for (let c = 1; c <= GRID; c++) {
        expect(rank(s, c), `S=${s}: C ${c - 1} -> ${c}`).toBeLessThanOrEqual(rank(s, c - 1));
      }
    }
  });

  it("the pure-support column (C=0) is exactly the original scale: <3 insufficient, 3-4 moderate, >=5 strong", () => {
    for (let s = 0; s <= GRID; s++) {
      const expected: EvidenceStrength = s < 3 ? "insufficient_evidence" : s < 5 ? "moderate" : "strong";
      expect(calculateEvidenceStrength(s, 0), `S=${s}`).toBe(expected);
    }
  });

  it("no tier ever exceeds what the same supporting evidence earns with ZERO contradiction", () => {
    for (let s = 0; s <= GRID; s++) {
      for (let c = 0; c <= GRID; c++) {
        expect(rank(s, c), `S=${s} C=${c}`).toBeLessThanOrEqual(rank(s, 0));
      }
    }
  });

  it("C. the live regression: S=2,C=0 -> S=2,C=1 does NOT become stronger (it was insufficient -> moderate)", () => {
    expect(calculateEvidenceStrength(2, 0)).toBe("insufficient_evidence");
    expect(calculateEvidenceStrength(2, 1)).toBe("insufficient_evidence");
    expect(rank(2, 1)).toBeLessThanOrEqual(rank(2, 0));
    // The same shape one tier up: 4 supporting + 1 contradicting must not beat 4 + 0.
    expect(rank(4, 1)).toBeLessThanOrEqual(rank(4, 0));
    // And with a single supporting case.
    expect(rank(1, 1)).toBeLessThanOrEqual(rank(1, 0));
  });

  it("D. more independent SUPPORTING evidence can still raise the tier (and never lowers it)", () => {
    expect(calculateEvidenceStrength(2, 0)).toBe("insufficient_evidence");
    expect(calculateEvidenceStrength(3, 0)).toBe("moderate");
    expect(calculateEvidenceStrength(5, 0)).toBe("strong");
    for (let c = 0; c <= GRID; c++) {
      for (let s = 1; s <= GRID; s++) {
        expect(rank(s, c), `C=${c}: S ${s - 1} -> ${s}`).toBeGreaterThanOrEqual(rank(s - 1, c));
      }
    }
  });

  it("E. strong contradiction is not ignored — it caps and reduces confidence", () => {
    expect(calculateEvidenceStrength(3, 20)).toBe("weak");
    expect(calculateEvidenceStrength(5, 20)).toBe("weak");
    // At S=5, growing contradiction walks the tier down, never up.
    expect(calculateEvidenceStrength(5, 0)).toBe("strong");
    expect(calculateEvidenceStrength(5, 3)).toBe("moderate");
    expect(calculateEvidenceStrength(5, 5)).toBe("weak");
    expect(rank(5, 20)).toBeLessThan(rank(5, 0));
    expect(rank(10, 20)).toBeLessThan(rank(10, 0));
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
