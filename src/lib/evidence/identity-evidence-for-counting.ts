import { selectEffectiveEvidence, type GroundingCheckForSelection } from "@/lib/dna/effective-evidence";
import type { DecisionStatementKind, DecisionStatementRef } from "./statement-ref";

// Identity matching used to read an identity's RAW Evidence pool to decide
// "what is already counted". Raw Evidence is immutable provenance and
// includes citations a grounding remediation explicitly REJECTED for the
// current version; counting them at the next generation re-inflated S/C,
// the independence groups and the "genuinely new" test.
//
// The counting input is therefore the EFFECTIVE evidence of the identity's
// CURRENT version (selectEffectiveEvidence — the one rule the "View
// Evidence" APIs and both recalculations already use):
//   - a version with grounding-check rows: only "supported" rows are
//     effective; "unsupported" rows AND rows with no check row (the
//     fail-closed reading) are REJECTED;
//   - a version with ZERO check rows (legacy, or never remediated): every
//     raw row is effective and nothing is rejected — the approved fallback,
//     unchanged.
// Only answer-sourced rows are countable; evidence with no interview answer
// (a Learning Insight agreement, a manual note) never reached the resolver.
export interface CountableEvidence {
  interviewAnswerId: string | null;
  /** Evidence Reach V1: set for a decision-statement citation (then interviewAnswerId is null). */
  decisionStatement: DecisionStatementRef | null;
  stance: "supporting" | "contradicting";
}

/** The two countable source shapes of a persisted evidence row; anything else (learning agreement, manual note) never reaches the resolver. */
export function countableSourceOf(row: { interviewAnswerId: string | null; decisionId?: string | null; decisionStatementKind?: string | null }): Pick<CountableEvidence, "interviewAnswerId" | "decisionStatement"> | null {
  if (row.decisionId && row.decisionStatementKind) return { interviewAnswerId: null, decisionStatement: { decisionId: row.decisionId, kind: row.decisionStatementKind as DecisionStatementKind } };
  if (row.interviewAnswerId !== null) return { interviewAnswerId: row.interviewAnswerId, decisionStatement: null };
  return null;
}

export interface EvidencePartition {
  /** What the current version's counts actually reflect. */
  effective: CountableEvidence[];
  /** Explicitly excluded for this version: must not re-enter counts by being cited again. */
  rejected: CountableEvidence[];
  /**
   * How many grounding-check rows the version had when this was read. The
   * writer compares it inside its transaction, so a check written in between
   * (which adds rows WITHOUT a new version) cannot slip past the guard.
   */
  checkCount: number;
}

export function partitionEvidenceForCounting(
  raw: readonly { id: string; interviewAnswerId: string | null; decisionId?: string | null; decisionStatementKind?: string | null; stance: "supporting" | "contradicting" }[],
  checks: readonly GroundingCheckForSelection[]
): EvidencePartition {
  const effectiveIds = new Set(selectEffectiveEvidence(raw, checks).map((e) => e.id));
  const effective: CountableEvidence[] = [];
  const rejected: CountableEvidence[] = [];
  for (const row of raw) {
    const source = countableSourceOf(row);
    if (source === null) continue;
    (effectiveIds.has(row.id) ? effective : rejected).push({ ...source, stance: row.stance });
  }
  return { effective, rejected, checkCount: checks.length };
}
