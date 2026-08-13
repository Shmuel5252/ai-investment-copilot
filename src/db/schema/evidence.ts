import { pgTable, uuid, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { dnaHypotheses } from "./dna";
import { strategyPrinciples } from "./strategy";
import { learningInsights } from "./learning";
import { transactions } from "./portfolio";
import { interviewAnswers } from "./interview";
import { decisionReviews } from "./decisions";
import { evidenceStanceEnum } from "./enums";

// Typed-nullable-FK + CHECK polymorphism (docs/data-model.md §0), not a
// string-typed subject_type/subject_id — this gives real FK integrity in
// Postgres for "what is this evidence about" and "where did it come
// from". Immutable: never edited or deleted once created — this is the
// mechanism the whole Traceable Judgments principle hangs on.
export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Subject — exactly one of these three.
    dnaHypothesisId: uuid("dna_hypothesis_id").references(() => dnaHypotheses.id),
    strategyPrincipleId: uuid("strategy_principle_id").references(() => strategyPrinciples.id),
    learningInsightId: uuid("learning_insight_id").references(() => learningInsights.id),

    stance: evidenceStanceEnum("stance").notNull(),

    // Source — at most one of these three, or a manual note if the
    // evidence has no linkable row.
    transactionId: uuid("transaction_id").references(() => transactions.id),
    interviewAnswerId: uuid("interview_answer_id").references(() => interviewAnswers.id),
    decisionReviewId: uuid("decision_review_id").references(() => decisionReviews.id),
    manualNoteText: text("manual_note_text"),

    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "evidence_exactly_one_subject",
      sql`num_nonnulls(${table.dnaHypothesisId}, ${table.strategyPrincipleId}, ${table.learningInsightId}) = 1`
    ),
    check(
      "evidence_at_most_one_source",
      sql`num_nonnulls(${table.transactionId}, ${table.interviewAnswerId}, ${table.decisionReviewId}, ${table.manualNoteText}) <= 1`
    ),
  ]
);
