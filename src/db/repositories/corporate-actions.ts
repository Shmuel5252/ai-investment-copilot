import { and, eq, lte } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { corporateActions } from "@/db/schema";

export type NewCorporateAction = InferInsertModel<typeof corporateActions>;

// Import Blockers V1 — insert-only, like every other historical-truth table
// (docs/data-model.md §10): a recorded split is a fact about the market
// and the investor's history; a wrong one is corrected by a new, explicit
// decision, never by editing. The UNIQUE (investor, ticker, effective_date)
// index refuses the same split twice; callers translate that violation.
export async function insertCorporateAction(db: typeof Db, values: NewCorporateAction) {
  const [row] = await db.insert(corporateActions).values(values).returning();
  return row!;
}

// All of an investor's actions (optionally only those effective on/before
// asOfDate — the same cutoff rule computePositions() applies), oldest first.
export async function listCorporateActionsForInvestor(db: typeof Db, investorId: string, asOfDate?: Date) {
  return db.query.corporateActions.findMany({
    where: asOfDate
      ? and(eq(corporateActions.investorId, investorId), lte(corporateActions.effectiveDate, asOfDate))
      : eq(corporateActions.investorId, investorId),
    orderBy: (a, { asc }) => [asc(a.effectiveDate), asc(a.ticker)],
  });
}
