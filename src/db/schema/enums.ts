// Shared pgEnums used across schema files. Centralized so the same
// concept (e.g. the four-value quality scale) isn't redefined per table.
import { pgEnum } from "drizzle-orm/pg-core";

// Evidence Strength scale (docs/data-model.md §2) — used by
// DNAHypothesisVersion, StrategyPrincipleVersion (observed), and
// LearningInsightVersion. Distinct from decisionQualityEnum below: this
// scale has "moderate" instead of "reasonable" and no direct equivalence
// between the two — they're computed by different rules for different
// questions ("how solid is this pattern" vs "how good was this decision").
export const evidenceStrengthEnum = pgEnum("evidence_strength", [
  "insufficient_evidence",
  "weak",
  "moderate",
  "strong",
]);

export const evidenceStanceEnum = pgEnum("evidence_stance", ["supporting", "contradicting"]);

export const dnaHypothesisStatusEnum = pgEnum("dna_hypothesis_status", [
  "active",
  "user_rejected",
]);

export const dnaCreatedByEnum = pgEnum("dna_created_by", ["ai_generated", "user_correction"]);

export const principleTypeEnum = pgEnum("principle_type", [
  "declared",
  "observed",
  "validated",
]);

export const principleCreatedByEnum = pgEnum("principle_created_by", [
  "user_declared",
  "ai_observed",
  "system_default",
]);

export const caseStatusEnum = pgEnum("case_status", ["researching", "decided", "archived"]);

export const decisionTypeEnum = pgEnum("decision_type", [
  "BUY",
  "PASS",
  "HOLD",
  "ADD",
  "REDUCE",
  "SELL",
]);

export const predictionStatusEnum = pgEnum("prediction_status", [
  "pending",
  "confirmed",
  "refuted",
  "inconclusive",
]);

// forecast: a stated belief about what WILL happen ("I think X will
// happen"). reentry_condition: a trigger for reconsidering the decision
// later ("I'd reconsider if X happens") — not a claim that X will
// happen, so "refuted" on one of these doesn't mean the reasoning was
// wrong the way it does for a forecast (docs/backlog.md: live-caught
// conflating the two, an exit condition extracted and judged as if it
// were a predicted outcome). Nullable — existing predictions created
// before this distinction existed have no real classification to
// backfill; never invented after the fact.
export const predictionKindEnum = pgEnum("prediction_kind", ["forecast", "reentry_condition"]);

export const addedByEnum = pgEnum("added_by", ["user", "ai"]);

export const thesisAccuracyEnum = pgEnum("thesis_accuracy", [
  "confirmed",
  "partially_confirmed",
  "refuted",
  "inconclusive",
  "insufficient_evidence",
]);

export const reviewDimensionNameEnum = pgEnum("review_dimension_name", [
  "thesis_quality",
  "evidence_quality",
  "risk_awareness",
  "valuation_awareness",
  "portfolio_fit",
  "strategy_consistency",
  "exit_conditions",
]);

// strong/reasonable/weak/insufficient_evidence — used for both
// ReviewDimension.verdict and DecisionReview.decision_quality_overall.
export const decisionQualityEnum = pgEnum("decision_quality", [
  "insufficient_evidence",
  "weak",
  "reasonable",
  "strong",
]);

export const correctionStatusEnum = pgEnum("correction_status", [
  "pending",
  "led_to_new_review",
  "led_to_new_version",
  "noted",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "buy",
  "sell",
  "dividend",
  "deposit",
  "withdrawal",
  "fee",
]);

export const transactionSourceEnum = pgEnum("transaction_source", ["csv_import", "manual_entry"]);

export const costBasisConfidenceEnum = pgEnum("cost_basis_confidence", [
  "known",
  "approximate",
  "unknown",
]);

export const importBatchStatusEnum = pgEnum("import_batch_status", [
  "processing",
  "completed",
  "failed",
]);

export const marketDataTypeEnum = pgEnum("market_data_type", [
  "quote",
  "profile",
  "historical_price",
]);

export const interviewSessionStatusEnum = pgEnum("interview_session_status", [
  "in_progress",
  "completed",
]);

export const ideaSourceEnum = pgEnum("idea_source", ["user_manual"]);
