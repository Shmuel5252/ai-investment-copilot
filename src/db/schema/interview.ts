import { pgTable, uuid, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { investors } from "./identity";
import { transactions } from "./portfolio";
import { interviewSessionStatusEnum, interviewSessionOriginEnum } from "./enums";

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
export const interviewAnswers = pgTable("interview_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewSessionId: uuid("interview_session_id")
    .notNull()
    .references(() => interviewSessions.id),
  transactionId: uuid("transaction_id").references(() => transactions.id),
  questionText: text("question_text").notNull(),
  answerText: text("answer_text").notNull(),
  supersedesAnswerId: uuid("supersedes_answer_id").references((): AnyPgColumn => interviewAnswers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
