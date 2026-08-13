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
