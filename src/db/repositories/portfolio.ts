import { eq } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { transactions, portfolioOpeningStates, importBatches } from "@/db/schema";

export type NewTransaction = InferInsertModel<typeof transactions>;
export type NewPortfolioOpeningState = InferInsertModel<typeof portfolioOpeningStates>;
export type NewImportBatch = InferInsertModel<typeof importBatches>;

// Transactions and PortfolioOpeningState are raw factual data, not
// judgments — correctable directly (docs/data-model.md §6), unlike
// everything in db/repositories/{dna,strategy,decisions,evidence}.ts.

export async function insertImportBatch(db: typeof Db, values: NewImportBatch) {
  const [row] = await db.insert(importBatches).values(values).returning();
  return row!;
}

// ImportBatch is traceability metadata about an import, not a judgment —
// same "raw fact, correctable" category as Transaction above, not the
// immutable-history tables in db/repositories/{dna,strategy,decisions,evidence}.ts.
// Narrow, explicitly-named exception (matching deleteTransaction below):
// used when an import needs to be fully reverted and redone (e.g. after
// fixing a real bug in the import logic itself), not a general-purpose
// "undo my import" UI action.
export async function deleteImportBatch(db: typeof Db, id: string) {
  await db.delete(importBatches).where(eq(importBatches.id, id));
}

export async function insertTransactions(db: typeof Db, values: NewTransaction[]) {
  if (values.length === 0) return [];
  return db.insert(transactions).values(values).returning();
}

export async function updateTransaction(
  db: typeof Db,
  id: string,
  values: Partial<NewTransaction>
) {
  await db
    .update(transactions)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(transactions.id, id));
}

export async function deleteTransaction(db: typeof Db, id: string) {
  await db.delete(transactions).where(eq(transactions.id, id));
}

export async function listTransactionsForInvestor(db: typeof Db, investorId: string) {
  return db.query.transactions.findMany({
    where: (t, { eq }) => eq(t.investorId, investorId),
    orderBy: (t, { asc }) => asc(t.transactionDate),
  });
}

export async function insertPortfolioOpeningState(
  db: typeof Db,
  values: NewPortfolioOpeningState
) {
  const [row] = await db.insert(portfolioOpeningStates).values(values).returning();
  return row!;
}

export async function updatePortfolioOpeningState(
  db: typeof Db,
  id: string,
  values: Partial<NewPortfolioOpeningState>
) {
  await db
    .update(portfolioOpeningStates)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(portfolioOpeningStates.id, id));
}

export async function getPortfolioOpeningState(db: typeof Db, investorId: string, ticker: string) {
  return db.query.portfolioOpeningStates.findFirst({
    where: (o, { eq, and }) => and(eq(o.investorId, investorId), eq(o.ticker, ticker)),
  });
}

export async function listPortfolioOpeningStatesForInvestor(db: typeof Db, investorId: string) {
  return db.query.portfolioOpeningStates.findMany({
    where: (o, { eq }) => eq(o.investorId, investorId),
  });
}
