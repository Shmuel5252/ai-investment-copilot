import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import type { DecisionStatementKind } from "./statement-ref";
import type { dnaHypothesisVersions, strategyPrincipleVersions } from "@/db/schema";
import type { TieredVersionSnapshot } from "@/lib/evidence/recalculate-confidence";
import {
  assessCitations,
  type EvidenceCitation,
  type EvidenceIndependenceResolver,
  type IndependenceBasis,
} from "@/lib/evidence/resolve-independence";

// Decision Independence V1 — DB-free planning + version construction for
// the independence recalculation, shared by DNA and Strategy.
//
// A version counted before the resolver existed stores episode-only
// counts. History is immutable, so when the resolver counts the SAME
// effective evidence differently, the correction is a NEW append-only
// version that repeats everything and differs only in the counts, the
// tier, the basis and the provenance. No new evidence, no grounding
// judgment, no AI: the only inputs are the persisted evidence and the
// resolver.
//
// DIRECTIONAL GUARD. An automatic append may only leave confidence the
// same or LOWER. A rise — a weak edge that disappeared, a backfilled trade
// that destroyed isolation, a policy change, missing candidate
// information — is uncertainty resolving in the flattering direction, so
// it is REPORTED for human review and never appended here. (A rise caused
// by an investor-confirmed INDEPENDENT fact could be permitted; that path
// is deliberately not built until a confirmation workflow exists — it
// fails closed into requires_review meanwhile.)
export const INDEPENDENCE_RECALCULATION_PROVENANCE = "system_independence_recalculation" as const;

export interface AppendIndependenceVersionPlan {
  action: "append_independence_version";
  baseVersionId: string;
  storedTier: EvidenceStrength;
  recomputedTier: EvidenceStrength;
  storedSupporting: number;
  storedContradicting: number;
  /** S_lb */
  supportingEvidenceCount: number;
  /** C_ub */
  contradictingEvidenceCount: number;
  independenceBasis: IndependenceBasis;
  changeReason: string;
}

export interface RequiresReviewPlan {
  action: "requires_review";
  reason: "confidence_rise" | "mixed_movement";
  baseVersionId: string;
  storedTier: EvidenceStrength;
  recomputedTier: EvidenceStrength;
  storedSupporting: number;
  storedContradicting: number;
  recomputedSupporting: number;
  recomputedContradicting: number;
  independenceBasis: IndependenceBasis;
}

export type IndependenceRecalculationPlan =
  | { action: "no_op"; reason: "not_tiered" | "no_effective_evidence" | "counts_unchanged" }
  | AppendIndependenceVersionPlan
  | RequiresReviewPlan;

// Idempotent like planConfidenceRecalculation: the decision compares the
// LATEST persisted counts with what the resolver computes right now. After
// an append the new version IS the latest and matches, so a rerun is a
// no-op. Equal counts never append even when the stored basis is NULL
// (legacy) — there is no basis backfill.
export function planIndependenceRecalculation(
  latest: TieredVersionSnapshot,
  effectiveCitations: readonly EvidenceCitation[],
  independence: EvidenceIndependenceResolver
): IndependenceRecalculationPlan {
  const storedTier = latest.evidenceStrength;
  const storedS = latest.supportingEvidenceCount;
  const storedC = latest.contradictingEvidenceCount;
  // Declared/validated Strategy principles carry no tier at all.
  if (storedTier === null || storedS === null || storedC === null) return { action: "no_op", reason: "not_tiered" };
  if (effectiveCitations.length === 0) return { action: "no_op", reason: "no_effective_evidence" };

  const assessed = assessCitations(independence, effectiveCitations);
  const s = assessed.supportingCount;
  const c = assessed.contradictingCount;
  if (s === storedS && c === storedC) return { action: "no_op", reason: "counts_unchanged" };

  const recomputedTier = calculateEvidenceStrength(s, c);
  const notHigher = s <= storedS && c >= storedC; // every count moved in the non-flattering direction
  if (!notHigher) {
    return {
      action: "requires_review",
      reason: s >= storedS && c <= storedC ? "confidence_rise" : "mixed_movement",
      baseVersionId: latest.id,
      storedTier,
      recomputedTier,
      storedSupporting: storedS,
      storedContradicting: storedC,
      recomputedSupporting: s,
      recomputedContradicting: c,
      independenceBasis: assessed.independenceBasis,
    };
  }

  const basis = assessed.independenceBasis;
  return {
    action: "append_independence_version",
    baseVersionId: latest.id,
    storedTier,
    recomputedTier,
    storedSupporting: storedS,
    storedContradicting: storedC,
    supportingEvidenceCount: s,
    contradictingEvidenceCount: c,
    independenceBasis: basis,
    changeReason:
      `Decision Independence (${basis.policyVersion}): the same effective evidence now counts as ` +
      `S=${s}, C=${c} (was S=${storedS}, C=${storedC}); tier ${storedTier} -> ${recomputedTier}. ` +
      `${basis.weakEdges.length} weak dependence edge(s), ${basis.confirmedFactIds.length} confirmed link fact(s). ` +
      `No new evidence; statement and evidence unchanged.`,
  };
}

type DnaVersionRow = typeof dnaHypothesisVersions.$inferSelect;
type StrategyVersionRow = typeof strategyPrincipleVersions.$inferSelect;

// Explicit field lists, never a spread of the base row: what is preserved
// is stated, and id / versionNumber / createdAt / identity can never leak
// in from the old row.
export function buildIndependenceRecalculatedDnaVersion(base: DnaVersionRow, plan: AppendIndependenceVersionPlan) {
  return {
    statementText: base.statementText,
    supportingEvidenceCount: plan.supportingEvidenceCount,
    contradictingEvidenceCount: plan.contradictingEvidenceCount,
    evidenceStrength: plan.recomputedTier,
    independenceBasisJson: plan.independenceBasis,
    createdBy: INDEPENDENCE_RECALCULATION_PROVENANCE,
    changeReason: plan.changeReason,
  };
}

export function buildIndependenceRecalculatedStrategyVersion(
  base: StrategyVersionRow,
  plan: AppendIndependenceVersionPlan
) {
  return {
    principleType: base.principleType,
    statementText: base.statementText,
    rationaleText: base.rationaleText,
    supportingEvidenceCount: plan.supportingEvidenceCount,
    contradictingEvidenceCount: plan.contradictingEvidenceCount,
    evidenceStrength: plan.recomputedTier,
    independenceBasisJson: plan.independenceBasis,
    createdBy: INDEPENDENCE_RECALCULATION_PROVENANCE,
    changeReason: plan.changeReason,
  };
}

export function citationsFromEvidence(
  rows: readonly { id: string; interviewAnswerId: string | null; decisionId?: string | null; decisionStatementKind?: string | null; stance: "supporting" | "contradicting" }[]
): EvidenceCitation[] {
  return rows.map((e) => ({
    interviewAnswerId: e.interviewAnswerId,
    decisionStatement: e.decisionId && e.decisionStatementKind ? { decisionId: e.decisionId, kind: e.decisionStatementKind as DecisionStatementKind } : null,
    stance: e.stance,
    evidenceId: e.id,
  }));
}

export type IndependenceRecalculationOutcome<V> =
  | { action: "no_op"; reason: "not_tiered" | "no_effective_evidence" | "counts_unchanged" | "superseded_concurrently" }
  | { action: "requires_review"; plan: RequiresReviewPlan }
  | { action: "appended"; plan: AppendIndependenceVersionPlan; version: V; carriedForwardChecks: number };
