import { eq } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { ideas, investmentCases } from "@/db/schema";

export type NewIdea = InferInsertModel<typeof ideas>;
export type NewInvestmentCase = InferInsertModel<typeof investmentCases>;

// Idea and InvestmentCase (while `researching`) are both Mutable —
// working documents, not frozen judgments (docs/data-model.md §10).
// Ordinary update is fine here, unlike everything in
// db/repositories/{dna,strategy,decisions,evidence}.ts.

export async function insertIdea(db: typeof Db, values: NewIdea) {
  const [row] = await db.insert(ideas).values(values).returning();
  return row!;
}

export async function getIdea(db: typeof Db, id: string) {
  return db.query.ideas.findFirst({ where: (i, { eq }) => eq(i.id, id) });
}

export async function listIdeasForInvestor(db: typeof Db, investorId: string) {
  return db.query.ideas.findMany({
    where: (i, { eq }) => eq(i.investorId, investorId),
    orderBy: (i, { desc }) => desc(i.createdAt),
  });
}

export async function markIdeaPromoted(db: typeof Db, ideaId: string, caseId: string) {
  await db.update(ideas).set({ promotedToCaseId: caseId }).where(eq(ideas.id, ideaId));
}

export async function insertInvestmentCase(db: typeof Db, values: NewInvestmentCase) {
  const [row] = await db.insert(investmentCases).values(values).returning();
  return row!;
}

export async function getInvestmentCase(db: typeof Db, id: string) {
  return db.query.investmentCases.findFirst({ where: (c, { eq }) => eq(c.id, id) });
}

export async function listInvestmentCasesForInvestor(db: typeof Db, investorId: string) {
  return db.query.investmentCases.findMany({
    where: (c, { eq }) => eq(c.investorId, investorId),
    orderBy: (c, { desc }) => desc(c.createdAt),
  });
}

export async function updateInvestmentCase(
  db: typeof Db,
  id: string,
  values: Partial<NewInvestmentCase>
) {
  const [row] = await db
    .update(investmentCases)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(investmentCases.id, id))
    .returning();
  return row!;
}
