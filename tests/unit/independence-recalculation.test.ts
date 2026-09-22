import { describe, expect, it } from "vitest";
import { dnaCreatedByEnum, principleCreatedByEnum } from "@/db/schema";
import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import {
  INDEPENDENCE_RECALCULATION_PROVENANCE,
  buildIndependenceRecalculatedDnaVersion,
  buildIndependenceRecalculatedStrategyVersion,
  citationsFromEvidence,
  planIndependenceRecalculation,
  type AppendIndependenceVersionPlan,
} from "@/lib/evidence/recalculate-independence";
import { createIndependenceResolver, serializeIndependenceBasis, type EffectiveLinkFact } from "@/lib/evidence/resolve-independence";
import { MP_ANSWERS, MP_TRADES, contextFromTrades, type AnswerSpec, type TradeSpec } from "../helpers/independence";

// Decision Independence V1 — DB-free planning for the independence
// recalculation. Real resolver, real calculateEvidenceStrength, no AI.
const snapshot = (S: number | null, C: number | null, tier: EvidenceStrength | null, id = "v1") => ({
  id,
  evidenceStrength: tier,
  supportingEvidenceCount: S,
  contradictingEvidenceCount: C,
});
const evidenceRows = (...specs: [string, "supporting" | "contradicting"][]) =>
  citationsFromEvidence(specs.map(([answer, stance], i) => ({ id: `ev-${i}`, interviewAnswerId: answer, stance })));

// The quiet-account MP/MRVL shape, with NO ticker named in any answer, so isolation is the only corroboration.
const UNNAMED: AnswerSpec[] = MP_ANSWERS.map((a) => ({ ...a, text: "" }));

describe("planIndependenceRecalculation", () => {
  const quiet = createIndependenceResolver(contextFromTrades(MP_TRADES, MP_ANSWERS));
  const both = evidenceRows(["a-mp-s2", "supporting"], ["a-mrvl", "supporting"]);

  it("a legacy version (S=2) whose evidence is really one decision plans exactly one append: S=1, C=0, tier stays insufficient", () => {
    const plan = planIndependenceRecalculation(snapshot(2, 0, "insufficient_evidence"), both, quiet);
    if (plan.action !== "append_independence_version") throw new Error(`expected append, got ${plan.action}`);
    expect(plan.supportingEvidenceCount).toBe(1);
    expect(plan.contradictingEvidenceCount).toBe(0);
    expect(plan.storedTier).toBe("insufficient_evidence");
    expect(plan.recomputedTier).toBe("insufficient_evidence");
    expect(plan.baseVersionId).toBe("v1");
    expect(plan.independenceBasis.supportingUpper).toBe(2);
    expect(plan.independenceBasis.weakEdges).toHaveLength(1);
    // Deterministic text, built from numbers only — never AI prose.
    expect(plan.changeReason).toBe(
      "Decision Independence (independence-policy-v1): the same effective evidence now counts as S=1, C=0 (was S=2, C=0); " +
        "tier insufficient_evidence -> insufficient_evidence. 1 weak dependence edge(s), 0 confirmed link fact(s). " +
        "No new evidence; statement and evidence unchanged."
    );
  });

  it("equal counts are a no-op even when the stored version is legacy (NULL basis) — there is no basis backfill", () => {
    const entryAndBuy = evidenceRows(["a-mp-buy", "supporting"], ["a-mrvl", "supporting"]); // same side: independent
    expect(planIndependenceRecalculation(snapshot(2, 0, "insufficient_evidence"), entryAndBuy, quiet)).toEqual({
      action: "no_op",
      reason: "counts_unchanged",
    });
  });

  it("is idempotent: once the corrected version is the latest, a rerun is a no-op", () => {
    const first = planIndependenceRecalculation(snapshot(2, 0, "insufficient_evidence"), both, quiet);
    if (first.action !== "append_independence_version") throw new Error("expected append");
    const rerun = planIndependenceRecalculation(
      snapshot(first.supportingEvidenceCount, first.contradictingEvidenceCount, first.recomputedTier, "v2"),
      both,
      quiet
    );
    expect(rerun).toEqual({ action: "no_op", reason: "counts_unchanged" });
  });

  it("declared/validated principles (no tier) and identities with no effective evidence are no-ops", () => {
    expect(planIndependenceRecalculation(snapshot(null, null, null), both, quiet)).toEqual({ action: "no_op", reason: "not_tiered" });
    expect(planIndependenceRecalculation(snapshot(2, 0, "insufficient_evidence"), [], quiet)).toEqual({
      action: "no_op",
      reason: "no_effective_evidence",
    });
  });

  describe("20. directional guard: a confidence RISE is never appended automatically", () => {
    it("21. a backfilled trade that destroys isolation would raise S_lb — reported for review, NOT appended", () => {
      const before = createIndependenceResolver(contextFromTrades(MP_TRADES, UNNAMED));
      const stored = planIndependenceRecalculation(snapshot(2, 0, "insufficient_evidence"), both, before);
      if (stored.action !== "append_independence_version") throw new Error("expected the quiet-account append");
      expect(stored.supportingEvidenceCount).toBe(1); // counted as ONE decision because the account was quiet

      // An unrelated trade is later imported inside the isolation margin: the pair is no longer an exclusive counterpart.
      const backfill: TradeSpec = { id: "late-import", ticker: "ZZZ", type: "buy", date: "2026-08-27" };
      const after = createIndependenceResolver(contextFromTrades([...MP_TRADES, backfill], UNNAMED));
      const plan = planIndependenceRecalculation(snapshot(1, 0, "insufficient_evidence", "v2"), both, after);
      expect(plan.action).toBe("requires_review");
      if (plan.action !== "requires_review") return;
      expect(plan.reason).toBe("confidence_rise");
      expect(plan.storedSupporting).toBe(1);
      expect(plan.recomputedSupporting).toBe(2);
      // The pair stays visible as a review-only candidate.
      expect(plan.independenceBasis.reviewOnly).toHaveLength(1);
    });

    it("missing candidate information (the trades are simply absent) is also a rise -> review, not append", () => {
      const noTrades = createIndependenceResolver({ ...contextFromTrades(MP_TRADES, UNNAMED), transactions: [] });
      const plan = planIndependenceRecalculation(snapshot(1, 0, "insufficient_evidence"), both, noTrades);
      expect(plan.action).toBe("requires_review");
    });

    it("a policy/corroboration change that makes a weak edge disappear is a rise -> review", () => {
      // Stored under a world where the investor's text corroborated; the text no longer names the counterpart.
      const busy: TradeSpec[] = [...MP_TRADES, { id: "busy", ticker: "BSY", type: "buy", date: "2026-08-27" }];
      const named = createIndependenceResolver(contextFromTrades(busy, MP_ANSWERS));
      const unnamed = createIndependenceResolver(contextFromTrades(busy, UNNAMED));
      expect(planIndependenceRecalculation(snapshot(2, 0, "insufficient_evidence"), both, named).action).toBe("append_independence_version");
      expect(planIndependenceRecalculation(snapshot(1, 0, "insufficient_evidence"), both, unnamed).action).toBe("requires_review");
    });

    it("newly detected weak dependence (a fall) is appendable, including newly available corroborating data", () => {
      const busy: TradeSpec[] = [...MP_TRADES, { id: "busy", ticker: "BSY", type: "buy", date: "2026-08-27" }];
      const unnamed = createIndependenceResolver(contextFromTrades(busy, UNNAMED));
      const named = createIndependenceResolver(contextFromTrades(busy, MP_ANSWERS));
      expect(planIndependenceRecalculation(snapshot(2, 0, "insufficient_evidence"), both, unnamed).action).toBe("no_op"); // nothing corroborates yet
      expect(planIndependenceRecalculation(snapshot(2, 0, "insufficient_evidence"), both, named).action).toBe("append_independence_version"); // the investor's own words arrive
    });

    it("mixed movement (S falls while C falls) is never automatic", () => {
      const r = createIndependenceResolver({
        episodeKeyByTransactionId: new Map(),
        transactions: [],
        answers: [
          { id: "s1", transactionId: null, answerText: "" },
          { id: "s2", transactionId: null, answerText: "" },
          { id: "c1", transactionId: null, answerText: "" },
        ],
        facts: [],
      });
      const rows = evidenceRows(["s1", "supporting"], ["s2", "supporting"], ["c1", "contradicting"]); // resolves to S=2, C=1
      const plan = planIndependenceRecalculation(snapshot(3, 2, "moderate"), rows, r);
      expect(plan.action).toBe("requires_review");
      if (plan.action === "requires_review") expect(plan.reason).toBe("mixed_movement");
    });

    it("a rise caused by a confirmed LINKED fact collapsing contradicting groups is review too (the investor-fact path is deliberately not built yet)", () => {
      const fact: EffectiveLinkFact = { id: "F", verdict: "linked", transactionIds: ["mp-s2", "mrvl-buy"] };
      const r = createIndependenceResolver(contextFromTrades(MP_TRADES, UNNAMED, [fact]));
      const rows = evidenceRows(["a-mp-s2", "contradicting"], ["a-mrvl", "contradicting"], ["a-mp-buy", "supporting"]);
      const plan = planIndependenceRecalculation(snapshot(1, 2, "insufficient_evidence"), rows, r);
      expect(plan.action).toBe("requires_review"); // C falls 2 -> 1
    });

    it("never appends a version whose recomputed counts are higher than the stored ones — exhaustively over small grids", () => {
      const r = createIndependenceResolver(contextFromTrades(MP_TRADES, UNNAMED));
      const rowSets = [
        evidenceRows(["a-mp-s2", "supporting"], ["a-mrvl", "supporting"]),
        evidenceRows(["a-mp-buy", "supporting"], ["a-mrvl", "supporting"]),
        evidenceRows(["a-mp-s2", "contradicting"], ["a-mrvl", "supporting"]),
        evidenceRows(["a-mp-s2", "supporting"], ["a-mrvl", "contradicting"], ["a-mp-buy", "supporting"]),
      ];
      for (const rows of rowSets) {
        for (let S = 0; S <= 4; S++) {
          for (let C = 0; C <= 3; C++) {
            const plan = planIndependenceRecalculation(snapshot(S, C, calculateEvidenceStrength(S, C)), rows, r);
            if (plan.action === "append_independence_version") {
              expect(plan.supportingEvidenceCount).toBeLessThanOrEqual(S);
              expect(plan.contradictingEvidenceCount).toBeGreaterThanOrEqual(C);
            }
          }
        }
      }
    });
  });
});

describe("version builders", () => {
  const quiet = createIndependenceResolver(contextFromTrades(MP_TRADES, MP_ANSWERS));
  const plan = planIndependenceRecalculation(
    snapshot(2, 0, "insufficient_evidence"),
    evidenceRows(["a-mp-s2", "supporting"], ["a-mrvl", "supporting"]),
    quiet
  ) as AppendIndependenceVersionPlan;

  const dnaBase = {
    id: "dna-v2",
    dnaHypothesisId: "dna-h",
    versionNumber: 2,
    statementText: "אתה נוטה למכור פוזיציה מרוויחה כשמתעוררת הזדמנות חדשה.",
    evidenceStrength: "insufficient_evidence" as EvidenceStrength,
    supportingEvidenceCount: 2,
    contradictingEvidenceCount: 0,
    createdAt: new Date("2026-09-10T00:00:00Z"),
    createdBy: "system_grounding_revalidation" as const,
    changeReason: "earlier reason",
    independenceBasisJson: null,
  };
  const strategyBase = {
    id: "st-v1",
    strategyPrincipleId: "st-p",
    versionNumber: 1,
    principleType: "observed" as const,
    statementText: "אתה נוטה לסגור פוזיציה מרוויחה.",
    rationaleText: "Observed as a pattern across your interview answers, not stated directly.",
    createdAt: new Date("2026-09-10T00:00:00Z"),
    createdBy: "ai_observed" as const,
    changeReason: null,
    evidenceStrength: "insufficient_evidence" as EvidenceStrength,
    supportingEvidenceCount: 2,
    contradictingEvidenceCount: 0,
    independenceBasisJson: null,
  };

  it("the new provenance value exists in BOTH enums", () => {
    expect(INDEPENDENCE_RECALCULATION_PROVENANCE).toBe("system_independence_recalculation");
    expect(dnaCreatedByEnum.enumValues).toContain("system_independence_recalculation");
    expect(principleCreatedByEnum.enumValues).toContain("system_independence_recalculation");
  });

  it("DNA: statement carried over byte for byte; counts are S_lb/C_ub; the basis and provenance are the only new information", () => {
    const built = buildIndependenceRecalculatedDnaVersion(dnaBase, plan);
    expect(built.statementText).toBe(dnaBase.statementText);
    expect(built.supportingEvidenceCount).toBe(1);
    expect(built.contradictingEvidenceCount).toBe(0);
    expect(built.createdBy).toBe("system_independence_recalculation");
    expect(built.independenceBasisJson).toEqual(plan.independenceBasis);
    expect(Object.keys(built).sort()).toEqual(
      ["changeReason", "contradictingEvidenceCount", "createdBy", "evidenceStrength", "independenceBasisJson", "statementText", "supportingEvidenceCount"]
    );
    // calculateEvidenceStrength over the stored counts reproduces the stored tier.
    expect(built.evidenceStrength).toBe(calculateEvidenceStrength(built.supportingEvidenceCount, built.contradictingEvidenceCount));
  });

  it("Strategy: statement, principleType and rationale carried over; a bundle is never involved", () => {
    const built = buildIndependenceRecalculatedStrategyVersion(strategyBase, plan);
    expect(built.statementText).toBe(strategyBase.statementText);
    expect(built.principleType).toBe("observed");
    expect(built.rationaleText).toBe(strategyBase.rationaleText);
    expect(built.createdBy).toBe("system_independence_recalculation");
    expect(built.independenceBasisJson).toEqual(plan.independenceBasis);
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

  it("the basis carried into the version is the byte-identical canonical basis", () => {
    const built = buildIndependenceRecalculatedDnaVersion(dnaBase, plan);
    expect(serializeIndependenceBasis(built.independenceBasisJson)).toBe(serializeIndependenceBasis(plan.independenceBasis));
  });

  it("citationsFromEvidence keeps the answer id, stance and evidence id", () => {
    expect(citationsFromEvidence([{ id: "e1", interviewAnswerId: null, stance: "supporting" }])).toEqual([
      { interviewAnswerId: null, stance: "supporting", evidenceId: "e1" },
    ]);
  });
});
