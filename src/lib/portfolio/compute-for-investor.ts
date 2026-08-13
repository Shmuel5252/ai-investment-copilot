import { eq, and, lte } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { transactions, portfolioOpeningStates } from "@/db/schema";
import {
  computePositions,
  type PortfolioState,
  type TransactionInput,
  type OpeningStateInput,
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

  const [txnRows, openingRows] = await Promise.all([
    db.select().from(transactions).where(txnWhere),
    db.select().from(portfolioOpeningStates).where(eq(portfolioOpeningStates.investorId, investorId)),
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

  return computePositions(txnInputs, openingInputs, asOfDate);
}
