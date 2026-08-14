import type { ProposedPersonalFit } from "@/lib/ai/case";

// Same trust boundary as src/lib/dna/validate-hypotheses.ts and
// src/lib/strategy/validate-principles.ts: an AI-cited id is never
// trusted until it's checked against real rows belonging to this
// investor. Unlike those two, an invalid citation here doesn't drop the
// whole result — personalFitText is analysis *about* already-evidenced
// DNA/Strategy entities, not a new evidence-backed claim in its own
// right — but `hasTraceableEvidence` tells the caller/UI honestly
// whether anything it says actually points back to a real row, so
// "Insufficient Evidence" can still be shown instead of quietly implying
// more grounding than there is (No Fake Certainty / Traceable Judgments).
export interface ValidatedPersonalFit {
  personalFitText: string;
  citedDnaHypothesisIds: string[];
  citedStrategyPrincipleIds: string[];
  hasTraceableEvidence: boolean;
}

export function validatePersonalFit(
  proposed: ProposedPersonalFit,
  validDnaHypothesisIds: ReadonlySet<string>,
  validStrategyPrincipleIds: ReadonlySet<string>
): ValidatedPersonalFit {
  const citedDnaHypothesisIds = (proposed.citedDnaHypothesisIds ?? []).filter(
    (id): id is string => typeof id === "string" && validDnaHypothesisIds.has(id)
  );
  const citedStrategyPrincipleIds = (proposed.citedStrategyPrincipleIds ?? []).filter(
    (id): id is string => typeof id === "string" && validStrategyPrincipleIds.has(id)
  );

  return {
    personalFitText: typeof proposed.personalFitText === "string" ? proposed.personalFitText.trim() : "",
    citedDnaHypothesisIds,
    citedStrategyPrincipleIds,
    hasTraceableEvidence: citedDnaHypothesisIds.length > 0 || citedStrategyPrincipleIds.length > 0,
  };
}
