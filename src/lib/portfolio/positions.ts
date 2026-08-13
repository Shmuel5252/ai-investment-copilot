// Deterministic portfolio-state reconstruction (docs/data-model.md §0
// "State מחושב, לא מאוחסן"). This is THE core calculation the whole
// product's Portfolio/Position concept rests on — no AI involvement,
// pure arithmetic over Transaction + PortfolioOpeningState.
//
// computePositions() is a pure function (no DB access) so it's cheap to
// unit test exhaustively per CLAUDE.md's Definition of Done ("cost-basis
// reconstruction" is explicitly named). computePositionsForInvestor()
// (compute-for-investor.ts) is the thin DB-fetching wrapper real callers
// use. This is the ONLY place average-cost/P&L math is implemented —
// CLAUDE.md's Engineering Principles say so explicitly; any other module
// that needs per-sell P&L or holding-period context (e.g.
// src/lib/interview/select-transactions.ts) consumes `sellTrace` below
// rather than re-deriving the math itself (an earlier version of the
// interview selector did re-derive it, and diverged in a way a live bug
// caught — see that file's git history).
//
// Cost basis method: Average Cost, not FIFO (docs/data-model.md §6 — this
// product isn't for tax reporting). Numbers are plain JS `number`, not an
// arbitrary-precision decimal type: this is a personal decision-support
// tool, not a ledger of record, and float64 has 15+ significant digits —
// comfortably precise for portfolio sizes this product will ever see.

export type CostBasisConfidence = "known" | "approximate" | "unknown";

export type TransactionType = "buy" | "sell" | "dividend" | "deposit" | "withdrawal" | "fee";

export interface TransactionInput {
  /** Optional — only needed if a caller wants sellTrace entries linkable back to a specific row. */
  id?: string;
  ticker: string | null;
  transactionType: TransactionType;
  /** Always positive — direction comes from transactionType, not sign. */
  quantity: number | null;
  price: number | null;
  /** Cash effect: negative = cash left the account, positive = cash entered it. */
  amount: number;
  transactionDate: Date;
}

export interface OpeningStateInput {
  ticker: string;
  quantity: number;
  costBasisPerShare: number | null;
  costBasisConfidence: CostBasisConfidence;
  asOfDate: Date;
}

export interface Position {
  ticker: string;
  quantity: number;
  /** null only if quantity ended up 0 (shouldn't normally appear in the output). */
  costBasisPerShare: number | null;
  costBasisConfidence: CostBasisConfidence;
}

export interface PortfolioWarning {
  ticker: string;
  message: string;
}

// One entry per SELL processed, in the same pass that builds `positions`
// — a natural byproduct of walking the transaction history in date
// order, not a second calculation. `sufficientHoldings: false` mirrors
// the same condition that produces a `warnings` entry; consumers that
// only want trustworthy P&L (like the interview selector) should filter
// on it rather than trusting realizedPnlPercent blindly.
export interface SellTraceEntry {
  transactionId?: string;
  ticker: string;
  transactionDate: Date;
  realizedPnlPercent: number;
  holdingPeriodDays: number;
  sufficientHoldings: boolean;
}

export interface PortfolioState {
  asOfDate: Date;
  cash: number;
  positions: Position[];
  /**
   * Flags e.g. a SELL that exceeds known holdings for a ticker — the
   * signature of a missing PortfolioOpeningState (docs/architecture.md
   * §2.1). We never silently assume the imported history is the whole
   * portfolio; this is where that assumption gets caught.
   */
  warnings: PortfolioWarning[];
  sellTrace: SellTraceEntry[];
}

const QUANTITY_EPSILON = 1e-9;
const MS_PER_DAY = 86_400_000;

interface TickerAccumulator {
  quantity: number;
  totalCostBasis: number;
  confidence: CostBasisConfidence;
  firstOpenedAt: Date;
}

export function computePositions(
  transactions: TransactionInput[],
  openingStates: OpeningStateInput[],
  asOfDate?: Date
): PortfolioState {
  const cutoff = asOfDate ?? null;
  const withinCutoff = (d: Date) => cutoff === null || d.getTime() <= cutoff.getTime();

  const byTicker = new Map<string, TickerAccumulator>();
  const warnings: PortfolioWarning[] = [];
  const sellTrace: SellTraceEntry[] = [];

  for (const os of openingStates) {
    if (!withinCutoff(os.asOfDate)) continue;
    const costBasisPerShare = os.costBasisPerShare ?? 0;
    byTicker.set(os.ticker, {
      quantity: os.quantity,
      totalCostBasis: costBasisPerShare * os.quantity,
      confidence: os.costBasisConfidence,
      firstOpenedAt: os.asOfDate,
    });
  }

  const sortedTxns = [...transactions]
    .filter((t) => withinCutoff(t.transactionDate))
    .sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());

  let cash = 0;

  for (const txn of sortedTxns) {
    cash += txn.amount;

    if (!txn.ticker) continue; // pure cash movement: deposit/withdrawal/fee with no position

    if (txn.transactionType === "buy") {
      const qty = txn.quantity ?? 0;
      const price = txn.price ?? 0;
      const existing = byTicker.get(txn.ticker) ?? {
        quantity: 0,
        totalCostBasis: 0,
        confidence: "known" as const,
        firstOpenedAt: txn.transactionDate,
      };
      existing.quantity += qty;
      existing.totalCostBasis += qty * price;
      byTicker.set(txn.ticker, existing);
    } else if (txn.transactionType === "sell") {
      const qty = txn.quantity ?? 0;
      const existing = byTicker.get(txn.ticker);
      const sufficientHoldings = !!existing && existing.quantity >= qty - QUANTITY_EPSILON;

      if (!sufficientHoldings) {
        warnings.push({
          ticker: txn.ticker,
          message:
            "SELL exceeds known holdings for this ticker — a PortfolioOpeningState may be " +
            "missing (this position may have been opened before the imported history window).",
        });
      }

      if (existing) {
        // Average cost method: a sell reduces quantity but leaves cost
        // basis per share unchanged.
        const avgCostPerShare = existing.quantity > 0 ? existing.totalCostBasis / existing.quantity : 0;
        const sellPrice = txn.price ?? (qty > 0 ? Math.abs(txn.amount) / qty : 0);
        const realizedPnlPercent =
          avgCostPerShare > 0 ? ((sellPrice - avgCostPerShare) / avgCostPerShare) * 100 : 0;
        const holdingPeriodDays = Math.round(
          (txn.transactionDate.getTime() - existing.firstOpenedAt.getTime()) / MS_PER_DAY
        );
        sellTrace.push({
          transactionId: txn.id,
          ticker: txn.ticker,
          transactionDate: txn.transactionDate,
          realizedPnlPercent,
          holdingPeriodDays,
          sufficientHoldings,
        });

        existing.quantity -= qty;
        existing.totalCostBasis -= avgCostPerShare * qty;
        if (existing.quantity < QUANTITY_EPSILON) {
          existing.quantity = 0;
          existing.totalCostBasis = 0;
        }
        byTicker.set(txn.ticker, existing);
      }
      // If there's no `existing` entry at all, there's nothing to reduce
      // or compute P&L from — the warning above already flags it; we
      // don't fabricate a negative holding or a trace entry with no
      // real cost basis behind it.
    }
    // dividend/fee: cash effect already applied above; no quantity/cost-basis change.
  }

  const positions: Position[] = [];
  for (const [ticker, state] of byTicker) {
    if (state.quantity <= QUANTITY_EPSILON) continue; // fully exited, not a current holding
    positions.push({
      ticker,
      quantity: state.quantity,
      costBasisPerShare: state.totalCostBasis / state.quantity,
      costBasisConfidence: state.confidence,
    });
  }
  positions.sort((a, b) => a.ticker.localeCompare(b.ticker));

  return { asOfDate: asOfDate ?? new Date(), cash, positions, warnings, sellTrace };
}
