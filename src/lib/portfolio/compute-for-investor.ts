import { eq, and, lte } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { transactions, portfolioOpeningStates, corporateActions } from "@/db/schema";
import {
  computePositions,
  type PortfolioState,
  type TransactionInput,
  type OpeningStateInput,
  type CorporateActionInput,
} from "./positions";

// Thin DB-fetching wrapper around the pure computePositions(). Numeric
// columns come back from Postgres as strings (drizzle/postgres.js avoid
// silent float coercion at the driver level) — converted to `number`
// here, at the one boundary where it matters, not scattered through the
// calling code.
export async function computePositionsForInvestor(
  db: typeof Db,
  investorId: string,
  asOfDate?: Date
): Promise<PortfolioState> {
  const txnWhere = asOfDate
    ? and(eq(transactions.investorId, investorId), lte(transactions.transactionDate, asOfDate))
    : eq(transactions.investorId, investorId);

  // Import Blockers V1: the investor's stock splits are an explicit input to
  // computePositions() — loaded here, in the ONE wrapper every consumer
  // (Journal, Decision Independence, decisions, reviews, Portfolio Fit,
  // import dry run) goes through, so split logic is never reinvented.
  const actionWhere = asOfDate
    ? and(eq(corporateActions.investorId, investorId), lte(corporateActions.effectiveDate, asOfDate))
    : eq(corporateActions.investorId, investorId);

  const [txnRows, openingRows, actionRows] = await Promise.all([
    db.select().from(transactions).where(txnWhere),
    db.select().from(portfolioOpeningStates).where(eq(portfolioOpeningStates.investorId, investorId)),
    db.select().from(corporateActions).where(actionWhere),
  ]);

  const txnInputs: TransactionInput[] = txnRows.map((t) => ({
    id: t.id,
    ticker: t.ticker,
    transactionType: t.transactionType,
    quantity: t.quantity === null ? null : Number(t.quantity),
    price: t.price === null ? null : Number(t.price),
    amount: Number(t.amount),
    transactionDate: t.transactionDate,
  }));

  const openingInputs: OpeningStateInput[] = openingRows.map((o) => ({
    ticker: o.ticker,
    quantity: Number(o.quantity),
    costBasisPerShare: o.costBasisPerShare === null ? null : Number(o.costBasisPerShare),
    costBasisConfidence: o.costBasisConfidence,
    asOfDate: o.asOfDate,
  }));

  const actionInputs: CorporateActionInput[] = actionRows.map((a) => ({
    ticker: a.ticker,
    effectiveDate: a.effectiveDate,
    ratioNumerator: a.ratioNumerator,
    ratioDenominator: a.ratioDenominator,
  }));

  return computePositions(txnInputs, openingInputs, asOfDate, actionInputs);
}
