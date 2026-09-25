import { pgTable, uuid, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { dnaHypotheses } from "./dna";
import { strategyPrinciples } from "./strategy";
import { learningInsights } from "./learning";
import { transactions } from "./portfolio";
import { interviewAnswers } from "./interview";
import { decisionReviews } from "./decisions";
import { evidenceStanceEnum, decisionStatementKindEnum } from "./enums";
import { decisions } from "./decisions";

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

    // Source — at most one of these four, or a manual note if the
    // evidence has no linkable row.
    transactionId: uuid("transaction_id").references(() => transactions.id),
    interviewAnswerId: uuid("interview_answer_id").references(() => interviewAnswers.id),
    decisionReviewId: uuid("decision_review_id").references(() => decisionReviews.id),
    // Distinct from the subject-side `learningInsightId` above (a row can
    // never have both set — that would trip evidence_exactly_one_subject
    // anyway, since only one of the three subject columns may be
    // non-null). This is "a LearningInsight the investor agreed with is
    // the *source* of new evidence for something else" — the mechanism
    // docs/data-model.md §8 already describes ("סגירת הלולאה ל-DNA": a
    // new DNAHypothesisVersion cites the LearningInsight as Evidence).
    // Added during the Learning Insight task: the original schema had no
    // column that could actually represent that already-documented
    // mechanism (`learning_insight_id` only ever appears in the
    // mutually-exclusive *subject* group, never in the source group) —
    // an approved-design gap discovered during implementation, corrected
    // per the Docs Sync Rule rather than left as a TODO.
    sourceLearningInsightId: uuid("source_learning_insight_id").references(() => learningInsights.id),
    // Evidence Reach V1 (OD-1): a decision-time investor statement — the
    // Decision plus WHICH of its three frozen investor-authored texts. Both
    // set together or neither (CHECK below). The text itself is never copied
    // here: it stays in the immutable DecisionSnapshot the decision points at.
    decisionId: uuid("decision_id").references(() => decisions.id),
    decisionStatementKind: decisionStatementKindEnum("decision_statement_kind"),
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
      sql`num_nonnulls(${table.transactionId}, ${table.interviewAnswerId}, ${table.decisionReviewId}, ${table.sourceLearningInsightId}, ${table.decisionId}, ${table.manualNoteText}) <= 1`
    ),
    check("evidence_decision_statement_kind_iff", sql`(${table.decisionId} IS NULL) = (${table.decisionStatementKind} IS NULL)`),
  ]
);
