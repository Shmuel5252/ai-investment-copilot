import { eq, type InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { interviewSessions, interviewAnswers } from "@/db/schema";

export type NewInterviewSession = InferInsertModel<typeof interviewSessions>;
export type NewInterviewAnswer = InferInsertModel<typeof interviewAnswers>;

export async function insertInterviewSession(db: typeof Db, values: NewInterviewSession) {
  const [row] = await db.insert(interviewSessions).values(values).returning();
  return row!;
}

export async function completeInterviewSession(db: typeof Db, id: string) {
  await db
    .update(interviewSessions)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(interviewSessions.id, id));
}

// Append-only + supersedes pointer (docs/data-model.md §0) — a
// "correction" is a new row with supersedesAnswerId set, never an edit
// of the original.
export async function insertInterviewAnswer(db: typeof Db, values: NewInterviewAnswer) {
  const [row] = await db.insert(interviewAnswers).values(values).returning();
  return row!;
}

export async function getAnswersForSession(db: typeof Db, interviewSessionId: string) {
  return db.query.interviewAnswers.findMany({
    where: (a, { eq }) => eq(a.interviewSessionId, interviewSessionId),
    orderBy: (a, { asc }) => asc(a.createdAt),
  });
}

// All of an investor's answers across every session, excluding any
// answer that a later one supersedes (docs/data-model.md §0 "Append-only
// + supersedes pointer") — the DNA engine should only ever see the
// current answer to a question, not a corrected-away version of it.
export async function getAllAnswersForInvestor(db: typeof Db, investorId: string) {
  const rows = await db
    .select({
      id: interviewAnswers.id,
      interviewSessionId: interviewAnswers.interviewSessionId,
      transactionId: interviewAnswers.transactionId,
      questionText: interviewAnswers.questionText,
      answerText: interviewAnswers.answerText,
      supersedesAnswerId: interviewAnswers.supersedesAnswerId,
      createdAt: interviewAnswers.createdAt,
      // Traceability only (Manual Historical Entry task, docs/backlog.md)
      // — guided_interview vs. user_initiated ("Tell me why"). Does not
      // affect evidenceStrength/weighting in dna.ts or strategy.ts, which
      // only read id/transactionId/questionText/answerText from this
      // return shape; the extra field is available to any future
      // consumer that wants it without changing either of those.
      origin: interviewSessions.origin,
    })
    .from(interviewAnswers)
    .innerJoin(interviewSessions, eq(interviewAnswers.interviewSessionId, interviewSessions.id))
    .where(eq(interviewSessions.investorId, investorId))
    .orderBy(interviewAnswers.createdAt);

  const supersededIds = new Set(
    rows.map((r) => r.supersedesAnswerId).filter((id): id is string => id !== null)
  );
  return rows.filter((r) => !supersededIds.has(r.id));
}
