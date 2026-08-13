import { pgTable, uuid, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { reviewDimensions, decisionReviews } from "./decisions";
import { dnaHypotheses } from "./dna";
import { strategyPrinciples } from "./strategy";
import { learningInsights } from "./learning";
import { correctionStatusEnum } from "./enums";

// Generic appeal/correction mechanism (docs/data-model.md §5) — one
// table for the whole system instead of a bespoke appeal flow per
// entity. Never overwrites what it targets; if accepted, it leads to a
// new DecisionReview or a new version row elsewhere (resultingReviewId /
// resultingVersionId just point at whatever got created).
export const corrections = pgTable(
  "corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Exactly one of these five is the target of the correction.
    reviewDimensionId: uuid("review_dimension_id").references(() => reviewDimensions.id),
    decisionReviewId: uuid("decision_review_id").references(() => decisionReviews.id),
    dnaHypothesisId: uuid("dna_hypothesis_id").references(() => dnaHypotheses.id),
    strategyPrincipleId: uuid("strategy_principle_id").references(() => strategyPrinciples.id),
    learningInsightId: uuid("learning_insight_id").references(() => learningInsights.id),

    userArgumentText: text("user_argument_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    status: correctionStatusEnum("status").notNull().default("pending"),

    resultingReviewId: uuid("resulting_review_id").references(() => decisionReviews.id),
    // Not a typed FK: depending on which subject this correction targets,
    // the resulting version could live in dna_hypothesis_versions,
    // strategy_principle_versions, strategy_versions, or
    // learning_insight_versions. It's a display-only cross-reference, not
    // an integrity-critical link (unlike Evidence's subject/source),
    // so a single nullable uuid without a DB-level FK is enough — adding
    // four more nullable FK columns here to cover every target table
    // wouldn't buy anything a repository-layer check doesn't already.
    resultingVersionId: uuid("resulting_version_id"),
  },
  (table) => [
    check(
      "correction_exactly_one_target",
      sql`num_nonnulls(${table.reviewDimensionId}, ${table.decisionReviewId}, ${table.dnaHypothesisId}, ${table.strategyPrincipleId}, ${table.learningInsightId}) = 1`
    ),
  ]
);
