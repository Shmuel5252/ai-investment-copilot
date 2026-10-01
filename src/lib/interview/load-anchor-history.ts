import type { db as Db } from "@/db/client";
import { listTransactionsForInvestor, listPortfolioOpeningStatesForInvestor } from "@/db/repositories/portfolio";
import { listCorporateActionsForInvestor } from "@/db/repositories/corporate-actions";
import type { AnchorHistory } from "./anchor-context";

// The stored history every point-in-time context is built from: the same
// transactions, opening states and recorded splits computePositionsForInvestor
// feeds every other consumer. Read at interview.start and again at answer
// time, so the snapshot persisted with an answer is always recomputed by the
// server, never taken from the client.
export async function loadAnchorHistory(db: typeof Db, investorId: string): Promise<AnchorHistory> {
  const [transactions, openingStates, corporateActions] = await Promise.all([
    listTransactionsForInvestor(db, investorId),
    listPortfolioOpeningStatesForInvestor(db, investorId),
    listCorporateActionsForInvestor(db, investorId),
  ]);
  return {
    transactions: transactions.map((t) => ({
      id: t.id,
      ticker: t.ticker,
      transactionType: t.transactionType,
      quantity: t.quantity === null ? null : Number(t.quantity),
      price: t.price === null ? null : Number(t.price),
      amount: Number(t.amount),
      transactionDate: t.transactionDate,
      intraDayOrder: t.intraDayOrder,
    })),
    openingStates: openingStates.map((o) => ({
      ticker: o.ticker,
      quantity: Number(o.quantity),
      costBasisPerShare: o.costBasisPerShare === null ? null : Number(o.costBasisPerShare),
      costBasisConfidence: o.costBasisConfidence,
      asOfDate: o.asOfDate,
    })),
    corporateActions: corporateActions.map((a) => ({ ticker: a.ticker, effectiveDate: a.effectiveDate, ratioNumerator: a.ratioNumerator, ratioDenominator: a.ratioDenominator })),
  };
}
