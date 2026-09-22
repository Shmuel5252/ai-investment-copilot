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

// Persisted verdict of a single checkEvidenceGrounding() call
// (src/lib/ai/dna-grounding.ts) against one Evidence row, scoped to one
// DNAHypothesisVersion (DNA Grounding Remediation task) — matches
// EvidenceGroundingVerdict exactly; kept separate from evidence_stance
// (a different concept: what the citation CLAIMS vs. whether it actually
// grounds that claim).
export const groundingVerdictEnum = pgEnum("grounding_verdict", ["supported", "unsupported"]);

export const dnaHypothesisStatusEnum = pgEnum("dna_hypothesis_status", [
  "active",
  "user_rejected",
]);

// "system_grounding_revalidation" (DNA Grounding Remediation task): a
// version created not by a fresh dna.generate proposal (ai_generated) and
// not by the investor disputing something (user_correction), but by the
// system re-checking this identity's OWN already-persisted evidence
// against the Evidence Grounding standard (src/lib/ai/dna-grounding.ts)
// and finding the valid evidence set has changed. Neither existing value
// would be honest here — see docs/data-model.md §2 for the full case.
//
// "system_confidence_recalculation" (Confidence Recalculation Remediation):
// a version appended when the evidenceStrength SEMANTICS changed and a
// latest version's stored tier no longer matches what the current helper
// computes from its own unchanged S/C. No new evidence, no grounding
// call, no new identity information, no investor action — a
// deterministic recomputation, so none of the three values above is
// truthful. Mirrored in principle_created_by below (enum values cannot
// be shared across enum types). This enum is also what
// learning_insight_versions.created_by uses.
//
// "system_independence_recalculation" (Decision Independence V1): a
// version appended because the deterministic independence resolver now
// counts the SAME effective evidence differently (a cross-ticker weak
// dependence edge, or a confirmed LinkFact). No new evidence, no AI, no
// investor action at write time — same truthfulness reasoning as above.
export const dnaCreatedByEnum = pgEnum("dna_created_by", [
  "ai_generated",
  "user_correction",
  "system_grounding_revalidation",
  "system_confidence_recalculation",
  "system_independence_recalculation",
]);

export const principleTypeEnum = pgEnum("principle_type", [
  "declared",
  "observed",
  "validated",
]);

// "system_grounding_revalidation" (Strategy Grounding + Identity
// Hardening task) — the exact same provenance concept as DNA's own
// dna_created_by value of the same name (see that enum's comment above),
// mirrored here rather than reused: a version created by the system
// re-checking this OBSERVED principle identity's own already-persisted
// evidence against Evidence Grounding, not by a fresh generateObserved
// proposal (ai_observed) and not by the investor (user_declared) or a
// fixed default (system_default). A separate Postgres enum type from
// dna_created_by — enum values cannot be shared across two different
// enum types, and principle_created_by already has its own three
// Strategy-specific values with no DNA equivalent.
// "system_confidence_recalculation" — the Strategy mirror of dna_created_by's
// value of the same name (see the comment there): a deterministic
// evidenceStrength recomputation over unchanged counts, not any of the
// other four origins.
export const principleCreatedByEnum = pgEnum("principle_created_by", [
  "user_declared",
  "ai_observed",
  "system_default",
  "system_grounding_revalidation",
  "system_confidence_recalculation",
  "system_independence_recalculation",
]);

// A LinkFact is an investor-authored assertion about which transactions
// were (or were not) one capital-reallocation decision — the only
// authoritative source of KNOWN_LINKED / KNOWN_INDEPENDENT. There is
// deliberately no origin/AI column: nothing but an investor-facing command
// may ever write one (src/db/repositories/link-facts.ts).
export const linkFactVerdictEnum = pgEnum("link_fact_verdict", ["linked", "independent"]);

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

// guided_interview: the algorithmic onboarding interview
// (select-transactions.ts picks the sample, questions are AI-generated
// over it). user_initiated: the investor chose, on their own, to record
// a rationale for a specific transaction ("Tell me why") — the question
// is deterministic code (src/lib/interview/tell-me-why-question.ts), not
// AI-generated. Traceability only (Manual Historical Entry task,
// docs/backlog.md) — does not change Evidence Strength/weighting by
// itself; that would be a separate Product decision.
export const interviewSessionOriginEnum = pgEnum("interview_session_origin", [
  "guided_interview",
  "user_initiated",
]);

export const ideaSourceEnum = pgEnum("idea_source", ["user_manual"]);

// Same-day transaction ordering (docs — Investment Episode Independence
// design, "Ordering contract"). Only meaningful when a transaction
// shares (investor_id, ticker, transaction_date) with at least one other
// transaction — see transactions.intraDayOrder's own comment for the
// three-state contract this participates in. 'user_declared': a tied
// group was detected and a human said the relative order is genuinely
// unknown. 'never_recorded': ambiguity discovered after the fact (e.g.
// backfilled over pre-existing rows) — no human was ever asked. Episode
// derivation (deriveEpisodeKeys(), src/lib/portfolio/positions.ts) treats
// both identically; the distinction is audit-only.
export const orderUnknownReasonEnum = pgEnum("order_unknown_reason", [
  "user_declared",
  "never_recorded",
]);
