import type { reviewDimensionNameEnum } from "@/db/schema";
import type { DecisionQuality } from "./decision-quality";

export type ReviewDimensionName = (typeof reviewDimensionNameEnum.enumValues)[number];

const REQUIRED_DIMENSIONS: readonly ReviewDimensionName[] = [
  "thesis_quality",
  "evidence_quality",
  "risk_awareness",
  "valuation_awareness",
  "portfolio_fit",
  "strategy_consistency",
  "exit_conditions",
];

// The fixed set of real DecisionSnapshot-adjacent fields the AI is
// actually given for a review (docs/data-model.md §5: "cited_snapshot_fields
// (json array — חובה תוכן, אחרת verdict=insufficient_evidence)"). A
// citation to anything outside this set is a hallucination, not a real
// pointer — dropped here, same trust boundary as every other AI-cites-by-id
// flow in this codebase (DNA/Strategy evidence, Personal Fit).
export const CITABLE_SNAPSHOT_FIELDS = [
  "userReasoningText",
  "risksConsideredText",
  "exitConditionsText",
  "aiRealtimeAssessmentText",
  "laterContexts",
  "thesisText",
  "thesisInterpretationText",
  "priceAtDecision",
  "size",
  "portfolioStateJson",
  "marketContext",
  "caseMarketIntelligence",
  "caseBullCaseText",
  "caseBearCaseText",
  "caseCatalystsText",
  "caseInvalidationConditionsText",
  "caseMarketBlindspotText",
  "caseDevilsAdvocateText",
  "casePersonalFitText",
  "casePortfolioFitText",
  "strategyPrinciplesInEffect",
  "dnaHypothesesInEffect",
  "predictionsAndResolutions",
] as const;
export type CitableSnapshotField = (typeof CITABLE_SNAPSHOT_FIELDS)[number];

// Prior Record → AI Decision Context V1: the frozen prior record is citable
// ONLY for a decision whose snapshot actually captured it. A legacy decision
// (prior_record_json NULL) citing it would point at something that never
// existed — dropped like any other invalid citation. Fail closed: not
// citable unless the caller says the frozen copy exists.
export const PRIOR_RECORD_CITABLE_FIELD = "priorRecord";

export interface ProposedReviewDimension {
  dimension: string;
  verdict: DecisionQuality;
  rationaleText: string;
  citedSnapshotFields: string[];
}

export interface ValidatedReviewDimension {
  dimension: ReviewDimensionName;
  verdict: DecisionQuality;
  rationaleText: string;
  citedSnapshotFields: string[];
}

// Always returns exactly the 7 required dimensions, in a fixed order,
// regardless of what the AI actually returned — decision_quality_overall's
// rollup table (docs/data-model.md §5) is defined in terms of counts out
// of a fixed 7, so a missing or duplicated dimension can't be allowed to
// silently skew it. A dimension the AI omitted becomes an honest
// insufficient_evidence entry, not a gap.
export function validateReviewDimensions(
  proposed: ProposedReviewDimension[],
  options: { priorRecordCaptured?: boolean } = {}
): ValidatedReviewDimension[] {
  const byDimension = new Map(proposed.map((p) => [p.dimension, p]));
  const validFieldSet = new Set<string>(CITABLE_SNAPSHOT_FIELDS);
  if (options.priorRecordCaptured === true) validFieldSet.add(PRIOR_RECORD_CITABLE_FIELD);

  return REQUIRED_DIMENSIONS.map((dimension) => {
    const entry = byDimension.get(dimension);
    if (!entry) {
      return {
        dimension,
        verdict: "insufficient_evidence",
        rationaleText: "The AI did not address this dimension.",
        citedSnapshotFields: [],
      };
    }

    const citedSnapshotFields = (entry.citedSnapshotFields ?? []).filter((f) => validFieldSet.has(f));
    // A verdict with no real citation behind it isn't a confident
    // verdict, it's an unsupported one — downgraded, never trusted as-is.
    const verdict: DecisionQuality =
      citedSnapshotFields.length === 0 && entry.verdict !== "insufficient_evidence"
        ? "insufficient_evidence"
        : entry.verdict;

    return {
      dimension,
      verdict,
      rationaleText: entry.rationaleText?.trim() || "No rationale given.",
      citedSnapshotFields,
    };
  });
}
