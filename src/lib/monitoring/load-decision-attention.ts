// The ONE DB-loading wrapper for deriveDecisionAttention() (see
// decision-attention.ts). Every caller (the decisions.attention query, the
// dashboard) goes through here so monitoring semantics are never rebuilt
// by hand. Reads only: decisions with their snapshot/predictions/reviews,
// the same-ticker BUY/SELL rows WITH created_at (the novelty clock), the
// history freshness, and the split-aware portfolio through the same
// computePositionsForInvestor() wrapper everything else uses — which is
// allowed to fail or warn: that becomes portfolio.status, never a guess.
import { and, eq, inArray } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { decisions, transactions } from "@/db/schema";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";
import { getHistoryFreshness } from "@/db/repositories/portfolio";
import {
  assertTimeZone,
  deriveDecisionAttention,
  type AttentionDecisionInput,
  type AttentionPortfolioInput,
  type AttentionTransactionInput,
  type DecisionAttentionResult,
} from "./decision-attention";

interface FrozenPortfolioState {
  positions?: { ticker?: unknown; quantity?: unknown }[];
}

/** The frozen holding of this ticker inside the immutable snapshot's portfolio_state_json (read, never rewritten). */
export function frozenHoldingQuantity(portfolioStateJson: unknown, ticker: string): number | null {
  const positions = (portfolioStateJson as FrozenPortfolioState | null)?.positions;
  if (!Array.isArray(positions)) return null;
  const match = positions.find((p) => p && p.ticker === ticker);
  if (!match) return 0;
  return typeof match.quantity === "number" && Number.isFinite(match.quantity) ? match.quantity : null;
}

export async function loadDecisionAttention(
  db: typeof Db,
  investorId: string,
  timeZone: string,
  today: Date = new Date()
): Promise<DecisionAttentionResult> {
  assertTimeZone(timeZone); // before any query: an unknown zone never reaches the derivation
  const [decisionRows, freshness] = await Promise.all([
    db.query.decisions.findMany({
      where: eq(decisions.investorId, investorId),
      with: { snapshot: { with: { thesis: { with: { predictions: true } } } }, reviews: true },
    }),
    getHistoryFreshness(db, investorId),
  ]);

  const tickers = [...new Set(decisionRows.map((d) => d.ticker))];
  const transactionRows =
    tickers.length === 0
      ? []
      : await db
          .select({
            id: transactions.id,
            ticker: transactions.ticker,
            transactionType: transactions.transactionType,
            quantity: transactions.quantity,
            price: transactions.price,
            transactionDate: transactions.transactionDate,
            createdAt: transactions.createdAt,
          })
          .from(transactions)
          .where(and(eq(transactions.investorId, investorId), inArray(transactions.ticker, tickers), inArray(transactions.transactionType, ["buy", "sell"])));

  let portfolio: AttentionPortfolioInput;
  try {
    const state = await computePositionsForInvestor(db, investorId);
    portfolio = {
      status: state.warnings.length === 0 ? "ok" : "warnings",
      warningCount: state.warnings.length,
      positions: state.positions.map((p) => ({ ticker: p.ticker, quantity: p.quantity, costBasisPerShare: p.costBasisPerShare })),
      episodeKeyByTransactionId: state.episodeKeyByTransactionId,
    };
  } catch {
    portfolio = { status: "unavailable", warningCount: 0, positions: [], episodeKeyByTransactionId: new Map() };
  }

  const decisionInputs: AttentionDecisionInput[] = decisionRows.map((d) => ({
    id: d.id,
    ticker: d.ticker,
    decisionType: d.decisionType,
    decisionDate: d.decisionDate,
    reviewByDate: d.reviewByDate,
    snapshot: d.snapshot ? { createdAt: d.snapshot.createdAt, frozenHoldingQuantity: frozenHoldingQuantity(d.snapshot.portfolioStateJson, d.ticker) } : null,
    predictions: (d.snapshot?.thesis?.predictions ?? []).map((p) => ({ id: p.id, status: p.status, checkableByDate: p.checkableByDate })),
    reviews: d.reviews.map((r) => ({ id: r.id, reviewDate: r.reviewDate })),
  }));
  const transactionInputs: AttentionTransactionInput[] = transactionRows.map((t) => ({
    id: t.id,
    ticker: t.ticker,
    transactionType: t.transactionType,
    quantity: t.quantity === null ? null : Number(t.quantity),
    price: t.price === null ? null : Number(t.price),
    transactionDate: t.transactionDate,
    createdAt: t.createdAt,
  }));

  return deriveDecisionAttention({
    today,
    timeZone,
    historyLatestTransactionDate: freshness.latestTransactionDate === null ? null : new Date(freshness.latestTransactionDate),
    decisions: decisionInputs,
    transactions: transactionInputs,
    portfolio,
  });
}
