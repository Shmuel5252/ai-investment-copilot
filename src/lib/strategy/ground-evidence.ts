import { assessCitations, type EvidenceIndependenceResolver } from "@/lib/evidence/resolve-independence";
import type { ValidatedObservedPrinciple, ValidatedPrincipleEvidence } from "./validate-principles";
import type { EvidenceGroundingCheckInput, EvidenceGroundingResult } from "@/lib/ai/dna-grounding";

// Strategy Grounding + Identity Hardening task — the Strategy-specific
// mirror of src/lib/dna/ground-evidence.ts's groundValidatedHypotheses.
// ValidatedObservedPrinciple (validate-principles.ts) is structurally
// identical to ValidatedHypothesis (statement/evidence/supportingCount/
// contradictingCount/evidenceStrength), so this is a near-mechanical
// port, not a redesign — same reasoning, same shared independence
// resolver (assessCitations — one algorithm for DNA and Strategy), same injected
// checkEvidenceGrounding() reused UNMODIFIED (re-verified generic before
// this task wired it in — its interface carries no DNA-specific types).
//
// Runs AFTER validateProposedObservedPrinciples()'s existing structural
// checks (citation id real, stance valid, description non-empty) and
// BEFORE anything is persisted — same gate position as DNA's, so a
// rejected citation never becomes a Strategy Evidence row at all (no
// grounding-check row is needed at generate time; there is nothing to
// mark "unsupported" for a citation that was never inserted). Persisted
// per-citation grounding-check rows exist only for the SEPARATE
// remediation problem (remediate-grounding.ts), auditing evidence that
// already predates this check.
export type StrategyGroundingCheckFn = (
  input: EvidenceGroundingCheckInput
) => Promise<EvidenceGroundingResult>;

export interface StrategyGroundingRunResult {
  principles: ValidatedObservedPrinciple[];
  /** Every citation excluded by grounding, across every principle — for logging/reporting, never for display as if it were still evidence. */
  excluded: { statement: string; interviewAnswerId: string; stance: "supporting" | "contradicting"; reason: string }[];
  /** Principles dropped entirely because zero citations survived grounding. */
  droppedPrinciples: string[];
}

// Runs every (principle, citation) pair through the grounding check,
// keeps only citations that come back `supported`, then recomputes
// supportingCount/contradictingCount/evidenceStrength from the SURVIVING
// citations only, via the exact same shared independence resolver
// (assessCitations) every other path uses. A principle left
// with zero surviving citations is dropped entirely — the same "no real
// evidence, not a thin principle, not an observed principle at all" rule
// validateProposedObservedPrinciples() already applies to hallucinated
// citation ids.
export async function groundValidatedObservedPrinciples(
  principles: readonly ValidatedObservedPrinciple[],
  answerTextById: ReadonlyMap<string, string>,
  independence: EvidenceIndependenceResolver,
  checkGrounding: StrategyGroundingCheckFn
): Promise<StrategyGroundingRunResult> {
  const result: ValidatedObservedPrinciple[] = [];
  const excluded: StrategyGroundingRunResult["excluded"] = [];
  const droppedPrinciples: string[] = [];

  for (const principle of principles) {
    const groundedEvidence: ValidatedPrincipleEvidence[] = [];

    for (const evidence of principle.evidence) {
      const sourceAnswerText = answerTextById.get(evidence.interviewAnswerId);
      // Shouldn't happen — validateProposedObservedPrinciples already
      // confirmed this id is real — but if the text is somehow
      // unavailable, that's exactly the kind of missing/malformed input
      // this gate must fail closed on, not silently pass through.
      if (sourceAnswerText === undefined) {
        excluded.push({
          statement: principle.statement,
          interviewAnswerId: evidence.interviewAnswerId,
          stance: evidence.stance,
          reason: "Source answer text unavailable — failing closed.",
        });
        continue;
      }

      let verdict: EvidenceGroundingResult;
      try {
        verdict = await checkGrounding({
          hypothesisStatement: principle.statement,
          stance: evidence.stance,
          sourceAnswerText,
        });
      } catch {
        verdict = { verdict: "unsupported", reason: "Grounding check threw — failing closed." };
      }

      if (verdict.verdict === "supported") {
        groundedEvidence.push(evidence);
      } else {
        excluded.push({
          statement: principle.statement,
          interviewAnswerId: evidence.interviewAnswerId,
          stance: evidence.stance,
          reason: verdict.reason,
        });
      }
    }

    if (groundedEvidence.length === 0) {
      droppedPrinciples.push(principle.statement);
      continue;
    }

    result.push({
      statement: principle.statement,
      evidence: groundedEvidence,
      ...assessCitations(independence, groundedEvidence),
    });
  }

  return { principles: result, excluded, droppedPrinciples };
}
