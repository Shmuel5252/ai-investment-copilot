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

export async function getInterviewSession(db: typeof Db, id: string) {
  return db.query.interviewSessions.findFirst({ where: (s, { eq }) => eq(s.id, id) });
}

export type SupersedingInsertResult =
  | { ok: true; row: typeof interviewAnswers.$inferSelect }
  | { ok: false; reason: "not_found" | "already_superseded" };

// Append a NEW answer that supersedes an existing one (Episode Journal V1),
// atomically enforcing the chain invariant: the old answer must belong to
// this investor (through its session) and may be superseded at most once —
// a chain, never a fork. There is no UNIQUE(supersedes_answer_id) in the
// schema (no migration in this unit), so two concurrent updates of the same
// answer would both pass a plain "has a successor?" read and fork the chain.
// Locking the superseded row FOR UPDATE serializes them: the second waits
// for the first to commit, then sees its successor and is refused. The old
// row itself is only ever locked and read — never written.
export async function insertSupersedingInterviewAnswer(
  db: typeof Db,
  investorId: string,
  values: NewInterviewAnswer & { supersedesAnswerId: string }
): Promise<SupersedingInsertResult> {
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ id: interviewAnswers.id, interviewSessionId: interviewAnswers.interviewSessionId })
      .from(interviewAnswers)
      .where(eq(interviewAnswers.id, values.supersedesAnswerId))
      .for("update");
    if (!previous) return { ok: false, reason: "not_found" };
    const session = await tx.query.interviewSessions.findFirst({
      where: (s, { eq }) => eq(s.id, previous.interviewSessionId),
      columns: { investorId: true },
    });
    if (!session || session.investorId !== investorId) return { ok: false, reason: "not_found" };
    const successor = await tx.query.interviewAnswers.findFirst({
      where: (a, { eq }) => eq(a.supersedesAnswerId, previous.id),
      columns: { id: true },
    });
    if (successor) return { ok: false, reason: "already_superseded" };
    const [row] = await tx.insert(interviewAnswers).values(values).returning();
    return { ok: true, row: row! };
  });
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
