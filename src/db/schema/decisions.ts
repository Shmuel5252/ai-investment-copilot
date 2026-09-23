import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  unique,
  primaryKey,
} from "drizzle-orm/pg-core";
import { investors } from "./identity";
import { investmentCases } from "./ideas-cases";
import { dnaHypothesisVersions } from "./dna";
import { strategyVersions } from "./strategy";
import { marketContexts } from "./market";
import {
  decisionTypeEnum,
  addedByEnum,
  decisionQualityEnum,
  thesisAccuracyEnum,
  reviewDimensionNameEnum,
  predictionStatusEnum,
  predictionKindEnum,
} from "./enums";

// Table order in this file matters: Decision -> DecisionSnapshot ->
// DecisionReview all reference each other in one direction only, but
// Prediction needs both Thesis and DecisionReview, so it's declared last
// to avoid a circular FK between files (docs/data-model.md correction —
// see the Core Data Model task summary).

// --- Thesis ---------------------------------------------------------
// Immutable, created together with its DecisionSnapshot. No FK back to
// decision_snapshots: that would make Thesis <-> DecisionSnapshot
// circular for no benefit — "which snapshot uses this thesis" is a
// trivial reverse lookup (decision_snapshots.thesis_id = X) since the
// relationship is a true 1:1.
export const theses = pgTable("theses", {
  id: uuid("id").primaryKey().defaultRandom(),
  thesisText: text("thesis_text").notNull(),
  aiInterpretationText: text("ai_interpretation_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Decision (thin identity) ----------------------------------------
export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    investmentCaseId: uuid("investment_case_id")
      .notNull()
      .references(() => investmentCases.id),
    ticker: text("ticker").notNull(),
    decisionType: decisionTypeEnum("decision_type").notNull(),
    decisionDate: timestamp("decision_date", { withTimezone: true }).notNull(),
    // Open-Decision Monitoring V1 — the investor's own review horizon
    // (docs/data-model.md §5). NULL = "no review date set" (legacy rows stay
    // NULL, never backfilled). Write-once: the only allowed transition is
    // NULL -> date (setReviewByDateIfUnset), never date -> other or -> NULL.
    reviewByDate: timestamp("review_by_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Enforces "at most one Decision per Case" — already the app-level
  // Slice 1 simplification documented in data-model.md's "פישוטים
  // מכוונים" §6 (a Case moves to status=decided after its one Decision),
  // but that was only a router-level status check, not a DB guarantee.
  // The most consequential instance of the same missing-constraint class
  // found via strategy_principles/strategy_versions: two near-simultaneous
  // decisions.create calls both reading investmentCase.status="researching"
  // before either commits would otherwise both succeed, producing two
  // separate immutable DecisionSnapshots for one Case — the one table in
  // this whole family where that's genuinely unrecoverable.
  (table) => [unique().on(table.investmentCaseId)]
);

// --- DecisionSnapshot (the immutable core) ---------------------------
// No UPDATE ever — enforced in the repository layer (only `insert` is
// exposed for this table; see src/db/repositories in the Historical
// Layer task). FKs to strategy/dna/market-context/thesis are all
// ON DELETE RESTRICT: nothing a snapshot points to may ever be deleted.
export const decisionSnapshots = pgTable("decision_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  decisionId: uuid("decision_id")
    .notNull()
    .references(() => decisions.id),
  priceAtDecision: numeric("price_at_decision").notNull(),
  size: numeric("size"),
  userReasoningText: text("user_reasoning_text").notNull(),
  aiRealtimeAssessmentText: text("ai_realtime_assessment_text"),
  risksConsideredText: text("risks_considered_text"),
  exitConditionsText: text("exit_conditions_text"),
  portfolioStateJson: jsonb("portfolio_state_json").notNull(),
  marketContextId: uuid("market_context_id")
    .notNull()
    .references(() => marketContexts.id, { onDelete: "restrict" }),
  strategyVersionId: uuid("strategy_version_id")
    .notNull()
    .references(() => strategyVersions.id, { onDelete: "restrict" }),
  thesisId: uuid("thesis_id")
    .notNull()
    .references(() => theses.id, { onDelete: "restrict" }),
  investmentCaseSnapshotJson: jsonb("investment_case_snapshot_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique().on(table.decisionId)]);

// Which DNA hypothesis *versions* were in effect at decision time — a
// real join table (not JSON) specifically so the FK can be
// ON DELETE RESTRICT (per explicit correction: version rows a Decision
// Snapshot points to must never be deletable).
export const decisionSnapshotDnaReferences = pgTable(
  "decision_snapshot_dna_references",
  {
    decisionSnapshotId: uuid("decision_snapshot_id")
      .notNull()
      .references(() => decisionSnapshots.id),
    dnaHypothesisVersionId: uuid("dna_hypothesis_version_id")
      .notNull()
      .references(() => dnaHypothesisVersions.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.decisionSnapshotId, table.dnaHypothesisVersionId] })]
);

// Append-only additions to a Decision after the fact — never edits the
// original Snapshot (Historical Integrity flow in CLAUDE.md).
export const laterContexts = pgTable("later_contexts", {
  id: uuid("id").primaryKey().defaultRandom(),
  decisionId: uuid("decision_id")
    .notNull()
    .references(() => decisions.id),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  text: text("text").notNull(),
  addedBy: addedByEnum("added_by").notNull(),
});

// --- DecisionReview ----------------------------------------------------
// Immutable once created; a repeat review (e.g. at 3mo, then 12mo) is a
// new row, never an edit of a prior one.
export const decisionReviews = pgTable("decision_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  decisionId: uuid("decision_id")
    .notNull()
    .references(() => decisions.id),
  reviewDate: timestamp("review_date", { withTimezone: true }).notNull().defaultNow(),
  narrativeSummaryText: text("narrative_summary_text").notNull(),
  // Deterministic rollup from the 7 ReviewDimension verdicts
  // (docs/data-model.md §5 rollup table) — never set directly by AI.
  decisionQualityOverall: decisionQualityEnum("decision_quality_overall").notNull(),
  thesisAccuracy: thesisAccuracyEnum("thesis_accuracy").notNull(),
  outcomeJson: jsonb("outcome_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Layer 2 (drill-down) of the two-layer review. cited_snapshot_fields
// must be non-empty unless verdict = insufficient_evidence — enforced in
// application code (src/lib/review), not just documented convention.
export const reviewDimensions = pgTable("review_dimensions", {
  id: uuid("id").primaryKey().defaultRandom(),
  decisionReviewId: uuid("decision_review_id")
    .notNull()
    .references(() => decisionReviews.id),
  dimension: reviewDimensionNameEnum("dimension").notNull(),
  verdict: decisionQualityEnum("verdict").notNull(),
  rationaleText: text("rationale_text").notNull(),
  citedSnapshotFields: jsonb("cited_snapshot_fields").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Prediction (declared last: needs both Thesis and DecisionReview) --
export const predictions = pgTable("predictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  thesisId: uuid("thesis_id")
    .notNull()
    .references(() => theses.id),
  claimText: text("claim_text").notNull(),
  // Nullable on purpose — set once at creation like claimText, never
  // backfilled for predictions created before this distinction existed
  // (src/db/schema/enums.ts has the full reasoning).
  kind: predictionKindEnum("kind"),
  checkableByDate: timestamp("checkable_by_date", { withTimezone: true }),
  status: predictionStatusEnum("status").notNull().default("pending"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByReviewId: uuid("resolved_by_review_id").references(() => decisionReviews.id),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
