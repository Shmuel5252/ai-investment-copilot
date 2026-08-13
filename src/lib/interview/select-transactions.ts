// Deterministic selection of "interesting" transactions to interview the
// investor about (docs/architecture.md §2.2) — which transactions to ask
// about is a code decision; only the phrasing of the question is AI's
// job (src/lib/ai/interview.ts).
//
// P&L and holding-period numbers come from computePositions()'s
// sellTrace — this module does NOT re-derive average-cost math itself.
// An earlier version did, and diverged from computePositions() in a way
// a live Claude call caught (a sell's P/L was computed without
// PortfolioOpeningState, mislabeling a gain as "biggest_loss"). Per
// CLAUDE.md, computePositions() is the one place that math lives.

import {
  computePositions,
  type TransactionInput,
  type OpeningStateInput,
} from "@/lib/portfolio/positions";

export type TransactionForSelection = TransactionInput & { id: string };
export type OpeningStateForSelection = OpeningStateInput;

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

  const buys = positionTrades.filter((t) => t.transactionType === "buy");

  const { sellTrace } = computePositions(transactions, openingStates);
  const txnById = new Map(transactions.map((t) => [t.id, t]));

  // Only trust P&L/holding-period context for sells computePositions()
  // itself considered backed by sufficient known holdings — the same
  // condition it uses to decide whether to raise a warning.
  const sellsWithContext = sellTrace
    .filter((s) => s.sufficientHoldings && s.transactionId)
    .map((s) => ({
      txn: txnById.get(s.transactionId!)!,
      pnlPercent: s.realizedPnlPercent,
      holdingDays: s.holdingPeriodDays,
    }))
    .filter((s) => s.txn !== undefined);

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
