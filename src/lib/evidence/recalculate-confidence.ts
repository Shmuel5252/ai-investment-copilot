import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import type { dnaHypothesisVersions, strategyPrincipleVersions } from "@/db/schema";

// Confidence Recalculation Remediation — DB-free planning + version
// construction, shared by DNA and Strategy.
//
// Why this exists: calculateEvidenceStrength()'s semantics changed
// (contradicting evidence can no longer raise a tier — docs/data-model.md
// §2), so a version persisted under the old rule can store a tier the
// current helper would not produce from its own, unchanged S/C. History is
// immutable, so the correction is a NEW append-only version that repeats
// everything and differs only in the recomputed tier and its provenance.
//
// This is NOT new evidence, NOT a grounding judgment, NOT new identity
// information and NOT an investor correction — nothing here calls or
// accepts an AI function, and the only source of the tier is the ONE
// production helper (never a second copy of its thresholds).
export const CONFIDENCE_RECALCULATION_PROVENANCE = "system_confidence_recalculation" as const;

// Structural, so DNA (non-null tier/counts) and Strategy (null for
// declared/validated principles) versions both fit.
export interface TieredVersionSnapshot {
  id: string;
  evidenceStrength: EvidenceStrength | null;
  supportingEvidenceCount: number | null;
  contradictingEvidenceCount: number | null;
}

export interface AppendRecalculatedVersionPlan {
  action: "append_recalculated_version";
  baseVersionId: string;
  storedTier: EvidenceStrength;
  recomputedTier: EvidenceStrength;
  supportingEvidenceCount: number;
  contradictingEvidenceCount: number;
  changeReason: string;
}

export type ConfidenceRecalculationPlan =
  | { action: "no_op"; reason: "not_tiered" | "already_current" }
  | AppendRecalculatedVersionPlan;

// Idempotency lives here: the decision compares the LATEST persisted
// state with what the current helper computes right now — no flag, no
// timestamp. After a correction is appended it IS the latest version, its
// tier matches, and every later call is a no-op.
export function planConfidenceRecalculation(latest: TieredVersionSnapshot): ConfidenceRecalculationPlan {
  const stored = latest.evidenceStrength;
  const supporting = latest.supportingEvidenceCount;
  const contradicting = latest.contradictingEvidenceCount;
  // Declared/validated Strategy principles carry no tier at all.
  if (stored === null || supporting === null || contradicting === null) {
    return { action: "no_op", reason: "not_tiered" };
  }

  const recomputed = calculateEvidenceStrength(supporting, contradicting);
  if (recomputed === stored) return { action: "no_op", reason: "already_current" };

  return {
    action: "append_recalculated_version",
    baseVersionId: latest.id,
    storedTier: stored,
    recomputedTier: recomputed,
    supportingEvidenceCount: supporting,
    contradictingEvidenceCount: contradicting,
    changeReason:
      `Evidence-strength semantics changed (contradicting evidence can no longer raise confidence): ` +
      `tier recalculated from the same counts, ${stored} -> ${recomputed} (S=${supporting}, C=${contradicting}). ` +
      `No new evidence; statement and evidence unchanged.`,
  };
}

type DnaVersionRow = typeof dnaHypothesisVersions.$inferSelect;
type StrategyVersionRow = typeof strategyPrincipleVersions.$inferSelect;

// Explicit field lists, never a spread of the base row: what is preserved
// is stated, and id / versionNumber / createdAt / identity can never leak
// in from the old row.
export function buildRecalculatedDnaVersion(base: DnaVersionRow, plan: AppendRecalculatedVersionPlan) {
  return {
    statementText: base.statementText,
    supportingEvidenceCount: plan.supportingEvidenceCount,
    contradictingEvidenceCount: plan.contradictingEvidenceCount,
    evidenceStrength: plan.recomputedTier,
    createdBy: CONFIDENCE_RECALCULATION_PROVENANCE,
    changeReason: plan.changeReason,
  };
}

export function buildRecalculatedStrategyVersion(base: StrategyVersionRow, plan: AppendRecalculatedVersionPlan) {
  return {
    principleType: base.principleType,
    statementText: base.statementText,
    rationaleText: base.rationaleText,
    supportingEvidenceCount: plan.supportingEvidenceCount,
    contradictingEvidenceCount: plan.contradictingEvidenceCount,
    evidenceStrength: plan.recomputedTier,
    createdBy: CONFIDENCE_RECALCULATION_PROVENANCE,
    changeReason: plan.changeReason,
  };
}

export interface GroundingCheckForCarryForward {
  evidenceId: string;
  verdict: "supported" | "unsupported";
  reason: string;
}

// Grounding checks are VERSION-scoped while Evidence is identity-scoped
// (docs/data-model.md §2): a version with check rows only counts the
// citations logged "supported" FOR THAT VERSION, and a version with none
// falls back to every raw citation. A new version with no rows would
// therefore silently re-admit citations the base version had excluded.
// Since the statement and the evidence are identical, the already-
// established verdicts still hold, so they are carried forward — not
// re-judged (no AI here) and not silently: each row keeps the original
// verdict and reason and says in its own text that it was carried, and
// from which version. Zero base rows -> zero carried rows (the new
// version falls back to raw evidence exactly as the base did).
export function carryForwardGroundingChecks(
  baseVersionId: string,
  baseChecks: readonly GroundingCheckForCarryForward[]
): GroundingCheckForCarryForward[] {
  return baseChecks.map((check) => ({
    evidenceId: check.evidenceId,
    verdict: check.verdict,
    reason:
      `Carried forward unchanged from version ${baseVersionId}: statement and evidence are identical, ` +
      `so no new grounding judgment was made (confidence-only recalculation). Original reason: ${check.reason}`,
  }));
}

export type ConfidenceRecalculationOutcome<V> =
  | { action: "no_op"; reason: "not_tiered" | "already_current" | "superseded_concurrently" }
  | { action: "appended"; plan: AppendRecalculatedVersionPlan; version: V; carriedForwardChecks: number };
