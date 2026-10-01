import { pgTable, uuid, text, timestamp, jsonb, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { investors } from "./identity";
import { transactions } from "./portfolio";
import { interviewSessionStatusEnum, interviewSessionOriginEnum, interviewQuestionProvenanceEnum } from "./enums";

export const interviewSessions = pgTable("interview_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: interviewSessionStatusEnum("status").notNull().default("in_progress"),
  // Backfill default covers every session that already existed before
  // this column — all of them really were guided_interview sessions,
  // since user_initiated ("Tell me why") didn't exist as a code path
  // yet. New writes always pass this explicitly (both call sites in
  // src/server/routers/interview.ts) rather than relying on the default.
  origin: interviewSessionOriginEnum("origin").notNull().default("guided_interview"),
});

// Append-only + supersedes pointer (docs/data-model.md §0) — simpler than
// an identity+version split for plain Q&A text. A correction is a new row
// with supersedesAnswerId pointing at what it replaces; the original is
// never edited.
//
// Guided Interview PIT contract (Unit 7C-B, migration 0019): three things kept
// apart on one row — question_text is the question wording only, answer_text
// the investor's words verbatim, and anchor_context the immutable
// point-in-time snapshot the question was built from, recomputed by the
// server at answer time (never taken from the client). question_provenance
// says which contract wrote the row; the CHECK ties the two together: legacy
// rows have no snapshot, every PIT row has one.
export const interviewAnswers = pgTable(
  "interview_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    interviewSessionId: uuid("interview_session_id")
      .notNull()
      .references(() => interviewSessions.id),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    questionText: text("question_text").notNull(),
    answerText: text("answer_text").notNull(),
    supersedesAnswerId: uuid("supersedes_answer_id").references((): AnyPgColumn => interviewAnswers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    questionProvenance: interviewQuestionProvenanceEnum("question_provenance").notNull(),
    anchorContext: jsonb("anchor_context"),
  },
  (table) => [
    check(
      "interview_answers_anchor_context_iff_pit",
      sql`(${table.anchorContext} IS NULL) = (${table.questionProvenance} IN ('guided_legacy', 'tell_me_why_legacy'))`
    ),
  ]
);
