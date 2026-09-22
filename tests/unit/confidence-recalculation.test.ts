import { readFileSync } from "node:fs";
import { fixtureBasis } from "../helpers/independence";
import { describe, expect, it } from "vitest";
import { dnaCreatedByEnum, principleCreatedByEnum } from "@/db/schema";
import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import { selectEffectiveEvidence } from "@/lib/dna/effective-evidence";
import {
  CONFIDENCE_RECALCULATION_PROVENANCE,
  buildRecalculatedDnaVersion,
  buildRecalculatedStrategyVersion,
  carryForwardGroundingChecks,
  planConfidenceRecalculation,
  type AppendRecalculatedVersionPlan,
} from "@/lib/evidence/recalculate-confidence";

// Confidence Recalculation Remediation — DB-free coverage. Everything runs
// the REAL production planner/builders and the REAL calculateEvidenceStrength
// and selectEffectiveEvidence; there is no AI callback anywhere to inject.
// DB-level behavior (old rows untouched, idempotency, concurrency,
// version-scoped checks) is in tests/integration/confidence-recalculation.test.ts.
const TIERS: EvidenceStrength[] = ["insufficient_evidence", "weak", "moderate", "strong"];

const dnaBase = {
  id: "dna-v1",
  dnaHypothesisId: "dna-h",
  versionNumber: 1,
  statementText: "You tend to hold winners based on conviction.",
  evidenceStrength: "moderate" as EvidenceStrength,
  supportingEvidenceCount: 2,
  contradictingEvidenceCount: 1,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  createdBy: "ai_generated" as const,
  changeReason: null,
  independenceBasisJson: null,
};
const strategyBase = {
  id: "st-v2",
  strategyPrincipleId: "st-p",
  versionNumber: 2,
  principleType: "observed" as const,
  statementText: "You seem to hold onto positions based on belief.",
  rationaleText: "Observed as a pattern across your interview answers, not stated directly.",
  createdAt: new Date("2026-09-19T00:00:00Z"),
  createdBy: "ai_observed" as const,
  changeReason: "New evidence from a later interview extended this existing pattern.",
  evidenceStrength: "moderate" as EvidenceStrength,
  supportingEvidenceCount: 2,
  contradictingEvidenceCount: 1,
  independenceBasisJson: null,
};

function appendPlanFor(v: { id: string; evidenceStrength: EvidenceStrength | null; supportingEvidenceCount: number | null; contradictingEvidenceCount: number | null }): AppendRecalculatedVersionPlan {
  const plan = planConfidenceRecalculation(v);
  if (plan.action !== "append_recalculated_version") throw new Error(`expected an append plan, got ${plan.action}`);
  return plan;
}

describe("A/B. stale-tier planning (the live S=2, C=1 shape)", () => {
  it("A. Strategy: stored moderate at S=2,C=1 plans an insufficient_evidence version", () => {
    const plan = appendPlanFor(strategyBase);
    expect(plan.storedTier).toBe("moderate");
    expect(plan.recomputedTier).toBe("insufficient_evidence");
    expect(plan.baseVersionId).toBe("st-v2");
    expect(buildRecalculatedStrategyVersion(strategyBase, plan).evidenceStrength).toBe("insufficient_evidence");
  });

  it("B. DNA: the identical state behaves identically", () => {
    const plan = appendPlanFor(dnaBase);
    expect(plan.recomputedTier).toBe("insufficient_evidence");
    expect(buildRecalculatedDnaVersion(dnaBase, plan).evidenceStrength).toBe("insufficient_evidence");
  });
});

describe("what a recalculated version preserves (D, E, F) and what it may change", () => {
  it("D/F. DNA: statement, S and C are carried over exactly; only tier, provenance and reason change", () => {
    const built = buildRecalculatedDnaVersion(dnaBase, appendPlanFor(dnaBase));
    expect(built.statementText).toBe(dnaBase.statementText);
    expect(built.supportingEvidenceCount).toBe(dnaBase.supportingEvidenceCount);
    expect(built.contradictingEvidenceCount).toBe(dnaBase.contradictingEvidenceCount);
    expect(Object.keys(built).sort()).toEqual(
      [
        "changeReason",
        "contradictingEvidenceCount",
        "createdBy",
        "evidenceStrength",
        "independenceBasisJson",
        "statementText",
        "supportingEvidenceCount",
      ]
    );
  });

  it("D. DNA: the independence basis of the base version is carried forward unchanged (a confidence-only version never reads as legacy)", () => {
    const basis = fixtureBasis(2, 1);
    const base = { ...dnaBase, independenceBasisJson: basis };
    expect(buildRecalculatedDnaVersion(base, appendPlanFor(base)).independenceBasisJson).toEqual(basis);
    expect(buildRecalculatedDnaVersion(dnaBase, appendPlanFor(dnaBase)).independenceBasisJson).toBeNull(); // legacy stays legacy
  });

  it("E. Strategy: the independence basis of the base version is carried forward unchanged", () => {
    const basis = fixtureBasis(2, 1);
    const base = { ...strategyBase, independenceBasisJson: basis };
    expect(buildRecalculatedStrategyVersion(base, appendPlanFor(base)).independenceBasisJson).toEqual(basis);
    expect(buildRecalculatedStrategyVersion(strategyBase, appendPlanFor(strategyBase)).independenceBasisJson).toBeNull();
  });

  it("D/E/F. Strategy: statement, principleType, rationale, S and C are carried over exactly", () => {
    const built = buildRecalculatedStrategyVersion(strategyBase, appendPlanFor(strategyBase));
    expect(built.statementText).toBe(strategyBase.statementText);
    expect(built.principleType).toBe("observed");
    expect(built.rationaleText).toBe(strategyBase.rationaleText);
    expect(built.supportingEvidenceCount).toBe(2);
    expect(built.contradictingEvidenceCount).toBe(1);
    expect(Object.keys(built).sort()).toEqual([
      "changeReason",
      "contradictingEvidenceCount",
      "createdBy",
      "evidenceStrength",
      "independenceBasisJson",
      "principleType",
      "rationaleText",
      "statementText",
      "supportingEvidenceCount",
    ]);
  });

  it("never carries the old row's id, version number, identity or timestamp into the new version's values", () => {
    for (const built of [
      buildRecalculatedDnaVersion(dnaBase, appendPlanFor(dnaBase)),
      buildRecalculatedStrategyVersion(strategyBase, appendPlanFor(strategyBase)),
    ] as Record<string, unknown>[]) {
      for (const forbidden of ["id", "versionNumber", "createdAt", "dnaHypothesisId", "strategyPrincipleId"]) {
        expect(built, forbidden).not.toHaveProperty(forbidden);
      }
    }
  });

  it("does not mutate the base row it reads", () => {
    const snapshot = JSON.stringify(strategyBase);
    buildRecalculatedStrategyVersion(strategyBase, appendPlanFor(strategyBase));
    planConfidenceRecalculation(strategyBase);
    expect(JSON.stringify(strategyBase)).toBe(snapshot);
  });

  it("the change reason states the transition and that nothing else changed", () => {
    const { changeReason } = appendPlanFor(strategyBase);
    expect(changeReason).toContain("moderate -> insufficient_evidence");
    expect(changeReason).toContain("S=2, C=1");
    expect(changeReason).toContain("No new evidence");
  });
});

describe("J. provenance", () => {
  it("is exactly system_confidence_recalculation, on every built version", () => {
    expect(CONFIDENCE_RECALCULATION_PROVENANCE).toBe("system_confidence_recalculation");
    expect(buildRecalculatedDnaVersion(dnaBase, appendPlanFor(dnaBase)).createdBy).toBe("system_confidence_recalculation");
    expect(buildRecalculatedStrategyVersion(strategyBase, appendPlanFor(strategyBase)).createdBy).toBe("system_confidence_recalculation");
  });

  it("is a real member of BOTH provenance enums, and is not any of the misleading existing values", () => {
    expect(dnaCreatedByEnum.enumValues).toContain(CONFIDENCE_RECALCULATION_PROVENANCE);
    expect(principleCreatedByEnum.enumValues).toContain(CONFIDENCE_RECALCULATION_PROVENANCE);
    for (const misleading of ["ai_generated", "ai_observed", "user_correction", "system_grounding_revalidation"]) {
      expect(CONFIDENCE_RECALCULATION_PROVENANCE).not.toBe(misleading);
    }
  });
});

describe("K/L/N. no-op, idempotency and generic transitions", () => {
  it("K. an already-correct latest version is a no-op — over every S,C in 0..12", () => {
    for (let s = 0; s <= 12; s++) {
      for (let c = 0; c <= 12; c++) {
        const plan = planConfidenceRecalculation({
          id: "v",
          evidenceStrength: calculateEvidenceStrength(s, c),
          supportingEvidenceCount: s,
          contradictingEvidenceCount: c,
        });
        expect(plan, `S=${s} C=${c}`).toEqual({ action: "no_op", reason: "already_current" });
      }
    }
  });

  it("declared/validated principles (no tier, no counts) are a no-op, never an error", () => {
    expect(planConfidenceRecalculation({ id: "v", evidenceStrength: null, supportingEvidenceCount: null, contradictingEvidenceCount: null })).toEqual({
      action: "no_op",
      reason: "not_tiered",
    });
  });

  it("L. planning the version a correction would produce is itself a no-op (a second run appends nothing)", () => {
    const plan = appendPlanFor(strategyBase);
    const afterCorrection = buildRecalculatedStrategyVersion(strategyBase, plan);
    expect(
      planConfidenceRecalculation({
        id: "st-v3",
        evidenceStrength: afterCorrection.evidenceStrength,
        supportingEvidenceCount: afterCorrection.supportingEvidenceCount,
        contradictingEvidenceCount: afterCorrection.contradictingEvidenceCount,
      })
    ).toEqual({ action: "no_op", reason: "already_current" });
  });

  it("N. corrects ANY stale transition, not only S=2,C=1 — every wrong stored tier over S,C in 0..12 recomputes to the production tier", () => {
    let corrected = 0;
    for (let s = 0; s <= 12; s++) {
      for (let c = 0; c <= 12; c++) {
        const expected = calculateEvidenceStrength(s, c);
        for (const stored of TIERS.filter((t) => t !== expected)) {
          const plan = planConfidenceRecalculation({
            id: "v",
            evidenceStrength: stored,
            supportingEvidenceCount: s,
            contradictingEvidenceCount: c,
          });
          expect(plan.action, `S=${s} C=${c} stored=${stored}`).toBe("append_recalculated_version");
          if (plan.action === "append_recalculated_version") {
            expect(plan.recomputedTier).toBe(expected);
            expect(plan.storedTier).toBe(stored);
            expect(plan.supportingEvidenceCount).toBe(s);
            expect(plan.contradictingEvidenceCount).toBe(c);
            corrected++;
          }
        }
      }
    }
    expect(corrected).toBeGreaterThan(0);
  });

  it("the other stale shapes the old rule produced are all corrected: (0,3) weak, (1,2) weak, (4,1) strong", () => {
    const cases: [number, number, EvidenceStrength, EvidenceStrength][] = [
      [0, 3, "weak", "insufficient_evidence"],
      [1, 2, "weak", "insufficient_evidence"],
      [2, 2, "weak", "insufficient_evidence"],
      [4, 1, "strong", "moderate"],
    ];
    for (const [s, c, stored, recomputed] of cases) {
      const plan = appendPlanFor({ id: "v", evidenceStrength: stored, supportingEvidenceCount: s, contradictingEvidenceCount: c });
      expect(plan.recomputedTier).toBe(recomputed);
    }
  });
});

describe("G/H. evidence set and version-scoped grounding state cannot change", () => {
  const raw = [{ id: "e-supported-1" }, { id: "e-supported-2" }, { id: "e-rejected" }, { id: "e-contra" }];
  const baseChecks = [
    { evidenceId: "e-supported-1", verdict: "supported" as const, reason: "matches the claim" },
    { evidenceId: "e-supported-2", verdict: "supported" as const, reason: "matches too" },
    { evidenceId: "e-rejected", verdict: "unsupported" as const, reason: "describes a different scenario" },
    { evidenceId: "e-contra", verdict: "supported" as const, reason: "genuinely contradicts" },
  ];

  it("H. carried-forward checks resolve to the SAME effective evidence as the base version's checks", () => {
    const carried = carryForwardGroundingChecks("base-version", baseChecks);
    expect(selectEffectiveEvidence(raw, carried).map((e) => e.id)).toEqual(
      selectEffectiveEvidence(raw, baseChecks).map((e) => e.id)
    );
    expect(selectEffectiveEvidence(raw, carried).map((e) => e.id)).not.toContain("e-rejected");
  });

  it("carrying nothing would have been a bug: a version with NO check rows re-admits the rejected citation (why carry-forward exists)", () => {
    expect(selectEffectiveEvidence(raw, []).map((e) => e.id)).toContain("e-rejected");
  });

  it("carry-forward keeps every verdict and evidence id, one row per base row, and never invents or drops one", () => {
    const carried = carryForwardGroundingChecks("base-version", baseChecks);
    expect(carried.map((c) => [c.evidenceId, c.verdict])).toEqual(baseChecks.map((c) => [c.evidenceId, c.verdict]));
  });

  it("carried rows are explicit, not silent: each names the source version and preserves the original reason verbatim", () => {
    for (const [i, row] of carryForwardGroundingChecks("base-version", baseChecks).entries()) {
      expect(row.reason).toContain("Carried forward unchanged from version base-version");
      expect(row.reason).toContain("no new grounding judgment was made");
      expect(row.reason).toContain(baseChecks[i]!.reason);
    }
  });

  it("a base version with no check rows carries nothing (its effective set stays every raw citation, exactly as before)", () => {
    expect(carryForwardGroundingChecks("base-version", [])).toEqual([]);
    expect(selectEffectiveEvidence(raw, []).map((e) => e.id)).toEqual(raw.map((e) => e.id));
  });
});

describe("I/O/P. static guards: no AI, no duplicated tier algorithm, no hard-coded real identities", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const between = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to));

  const planner = read("src/lib/evidence/recalculate-confidence.ts");
  const orchestrator = read("src/db/repositories/confidence-recalculation.ts");
  const dnaExecutor = between(read("src/db/repositories/dna.ts"), "export async function recalculateDnaHypothesisConfidence", "export async function setDnaHypothesisStatus");
  const strategyExecutor = between(read("src/db/repositories/strategy.ts"), "export async function recalculatePrincipleConfidence", '// "User approves a change');
  const remediationCode = [planner, orchestrator, dnaExecutor, strategyExecutor];

  it("the code under inspection was actually extracted (the static guards below are not vacuous)", () => {
    for (const code of remediationCode) expect(code.length).toBeGreaterThan(500);
    expect(dnaExecutor).toContain("planConfidenceRecalculation");
    expect(strategyExecutor).toContain("planConfidenceRecalculation");
  });

  it("I. no remediation code touches an AI module, the Anthropic client, or any grounding/identity function", () => {
    for (const code of remediationCode) {
      expect(code).not.toMatch(/@\/lib\/ai|anthropic|checkEvidenceGrounding|classifyHypothesisMatch|messages\.create/i);
    }
    expect(planConfidenceRecalculation.length).toBe(1); // takes a version snapshot only — no callback parameter
  });

  it("O. the tier comes from the ONE production helper: it is imported, and no threshold logic is duplicated", () => {
    expect(planner).toMatch(/import \{[^}]*calculateEvidenceStrength[^}]*\} from "@\/lib\/dna\/evidence-strength"/);
    for (const code of remediationCode) {
      // the helper's own thresholds (0.6 / 0.8 ratio gates, <3 / >=5 sample gates)
      expect(code).not.toMatch(/\b0\.6\b|\b0\.8\b|<\s*3\b|>=\s*5\b/);
    }
  });

  it("O. the planner's tier equals calculateEvidenceStrength for every S,C — no drift possible", () => {
    for (let s = 0; s <= 12; s++) {
      for (let c = 0; c <= 12; c++) {
        const wrong: EvidenceStrength = calculateEvidenceStrength(s, c) === "moderate" ? "weak" : "moderate";
        const plan = planConfidenceRecalculation({ id: "v", evidenceStrength: wrong, supportingEvidenceCount: s, contradictingEvidenceCount: c });
        if (plan.action === "append_recalculated_version") expect(plan.recomputedTier).toBe(calculateEvidenceStrength(s, c));
      }
    }
  });

  it("P. no real identity, version id, UUID or ticker appears in any remediation code", () => {
    for (const code of remediationCode) {
      expect(code).not.toMatch(/7c3665ca|3653aeed|a48426b1|646e7663|0dc4b076/i);
      expect(code).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(code).not.toMatch(/\b(MRVL|SQQQ|SPCX|CMCSA)\b/);
    }
  });
});
