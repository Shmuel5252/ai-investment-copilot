import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { evidence } from "@/db/schema";

export type NewEvidence = InferInsertModel<typeof evidence>;

// Immutable — this is the mechanism Traceable Judgments hangs on
// (docs/data-model.md §2). The exactly-one-subject / at-most-one-source
// invariants are enforced by CHECK constraints in the DB itself (see
// tests/integration/schema-constraints.test.ts), not just here.
export async function insertEvidence(db: typeof Db, values: NewEvidence) {
  const [row] = await db.insert(evidence).values(values).returning();
  return row!;
}

export async function getEvidenceForDnaHypothesis(db: typeof Db, dnaHypothesisId: string) {
  return db.query.evidence.findMany({
    where: (e, { eq }) => eq(e.dnaHypothesisId, dnaHypothesisId),
    orderBy: (e, { desc }) => desc(e.createdAt),
  });
}

export async function getEvidenceForStrategyPrinciple(db: typeof Db, strategyPrincipleId: string) {
  return db.query.evidence.findMany({
    where: (e, { eq }) => eq(e.strategyPrincipleId, strategyPrincipleId),
    orderBy: (e, { desc }) => desc(e.createdAt),
  });
}

export async function getEvidenceForLearningInsight(db: typeof Db, learningInsightId: string) {
  return db.query.evidence.findMany({
    where: (e, { eq }) => eq(e.learningInsightId, learningInsightId),
    orderBy: (e, { desc }) => desc(e.createdAt),
  });
}
