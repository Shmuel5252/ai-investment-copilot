// Deterministic selection of "interesting" transactions to interview the
// investor about (docs/architecture.md §2.2) — which transactions to ask
// about is a code decision; only the phrasing of the question is AI's
// job (src/lib/ai/interview.ts).
//
// Re-derives running average-cost state per ticker (same method as
// computePositions()) rather than reusing it directly: this function
// needs per-SELL intermediate context (P/L%, holding period) that
// computePositions()'s final-state-only output doesn't expose, and
// entangling the two would make both harder to reason about for a
// modest amount of shared logic. It DOES need the same
// PortfolioOpeningState seeding computePositions uses, though — without
// it, P/L on a ticker that had a pre-import-window position looks
// computed but is actually wrong (caught via a live test: a real Claude
// call correctly noticed a "biggest_loss" label on a trade whose P/L,
// computed only from the imported window, showed a gain).

import type { TransactionType, CostBasisConfidence } from "@/lib/portfolio/positions";

export interface TransactionForSelection {
  id: string;
  ticker: string | null;
  transactionType: TransactionType;
  quantity: number | null;
  price: number | null;
  amount: number;
  transactionDate: Date;
}

export interface OpeningStateForSelection {
  ticker: string;
  quantity: number;
  costBasisPerShare: number | null;
  costBasisConfidence: CostBasisConfidence;
  asOfDate: Date;
}

export type SelectionCategory =
  | "biggest_gain"
  | "biggest_loss"
  | "longest_hold"
  | "quickest_flip"
  | "largest_buy"
  | "first_trade";

export interface SelectedTransaction {
  transaction: TransactionForSelection;
  category: SelectionCategory;
  realizedPnlPercent?: number;
  holdingPeriodDays?: number;
}

const MS_PER_DAY = 86_400_000;
const QUANTITY_EPSILON = 1e-9;

export function selectInterestingTransactions(
  transactions: TransactionForSelection[],
  openingStates: OpeningStateForSelection[] = [],
  maxCount = 6
): SelectedTransaction[] {
  const positionTrades = transactions
    .filter((t): t is TransactionForSelection & { ticker: string } =>
      t.ticker !== null && (t.transactionType === "buy" || t.transactionType === "sell")
    )
    .sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());

  interface TickerState {
    quantity: number;
    totalCost: number;
    firstOpenedAt: Date;
  }
  const byTicker = new Map<string, TickerState>();
  for (const os of openingStates) {
    byTicker.set(os.ticker, {
      quantity: os.quantity,
      totalCost: (os.costBasisPerShare ?? 0) * os.quantity,
      firstOpenedAt: os.asOfDate,
    });
  }

  const sellsWithContext: Array<{
    txn: TransactionForSelection;
    pnlPercent: number;
    holdingDays: number;
  }> = [];
  const buys: TransactionForSelection[] = [];

  for (const txn of positionTrades) {
    const existing = byTicker.get(txn.ticker);

    if (txn.transactionType === "buy") {
      buys.push(txn);
      const qty = txn.quantity ?? 0;
      const price = txn.price ?? 0;
      if (existing) {
        existing.quantity += qty;
        existing.totalCost += qty * price;
      } else {
        byTicker.set(txn.ticker, { quantity: qty, totalCost: qty * price, firstOpenedAt: txn.transactionDate });
      }
      continue;
    }

    // sell
    const qty = txn.quantity ?? 0;
    if (existing && existing.quantity >= qty - QUANTITY_EPSILON) {
      const avgCost = existing.totalCost / existing.quantity;
      const sellPrice = txn.price ?? (qty > 0 ? Math.abs(txn.amount) / qty : 0);
      const pnlPercent = avgCost > 0 ? ((sellPrice - avgCost) / avgCost) * 100 : 0;
      const holdingDays = Math.round(
        (txn.transactionDate.getTime() - existing.firstOpenedAt.getTime()) / MS_PER_DAY
      );
      sellsWithContext.push({ txn, pnlPercent, holdingDays });

      existing.quantity -= qty;
      existing.totalCost -= avgCost * qty;
    }
    // A sell exceeding known holdings (no opening state covering it, or
    // none at all) has no trustworthy cost basis — Trade Import already
    // surfaces that gap as a warning; interview selection just skips
    // using it for P/L-based questions rather than computing a
    // misleading number from partial data.
  }

  const usedIds = new Set<string>();
  const candidates: SelectedTransaction[] = [];

  function tryAdd(
    txn: TransactionForSelection,
    category: SelectionCategory,
    extra?: { realizedPnlPercent?: number; holdingPeriodDays?: number }
  ) {
    if (usedIds.has(txn.id)) return false;
    usedIds.add(txn.id);
    candidates.push({ transaction: txn, category, ...extra });
    return true;
  }

  // Picks the most-extreme entry in `sorted` (best match first, already
  // filtered to ones that actually qualify for this category) that
  // hasn't already been claimed by another category, so a small
  // transaction history still surfaces distinct questions instead of
  // silently dropping a category whenever its top pick collides with an
  // already-used transaction — exactly the case that matters most (a
  // new user with only a handful of trades).
  function tryAddFirstUnused(sorted: typeof sellsWithContext, category: SelectionCategory) {
    for (const candidate of sorted) {
      const added = tryAdd(candidate.txn, category, {
        realizedPnlPercent: candidate.pnlPercent,
        holdingPeriodDays: candidate.holdingDays,
      });
      if (added) return;
    }
  }

  if (sellsWithContext.length > 0) {
    // "Biggest gain"/"biggest loss" must be an actual gain/loss — the
    // relatively-worst sell among an all-winners history is still a
    // win, not a loss, and labeling it "biggest_loss" would be simply
    // wrong, not just imprecise (unlike the superlative categories,
    // where "not literally the most extreme" is still an honest label).
    const gains = sellsWithContext.filter((s) => s.pnlPercent > 0).sort((a, b) => b.pnlPercent - a.pnlPercent);
    tryAddFirstUnused(gains, "biggest_gain");

    const losses = sellsWithContext.filter((s) => s.pnlPercent < 0).sort((a, b) => a.pnlPercent - b.pnlPercent);
    tryAddFirstUnused(losses, "biggest_loss");

    const byHoldingDesc = [...sellsWithContext].sort((a, b) => b.holdingDays - a.holdingDays);
    tryAddFirstUnused(byHoldingDesc, "longest_hold");
    tryAddFirstUnused([...byHoldingDesc].reverse(), "quickest_flip");
  }

  if (buys.length > 0) {
    const byAmountDesc = [...buys].sort(
      (a, b) => (b.quantity ?? 0) * (b.price ?? 0) - (a.quantity ?? 0) * (a.price ?? 0)
    );
    for (const candidate of byAmountDesc) {
      if (tryAdd(candidate, "largest_buy")) break;
    }
  }

  if (positionTrades.length > 0) {
    // Unlike the categories above, "first trade" is a factual claim, not
    // a relative superlative — no fallback. If the actual first trade is
    // already in the list under another label, that's fine: it's still
    // being asked about, just framed differently; mislabeling a later
    // trade as "first" would be actively wrong, not just less precise.
    tryAdd(positionTrades[0]!, "first_trade");
  }

  return candidates.slice(0, maxCount);
}
