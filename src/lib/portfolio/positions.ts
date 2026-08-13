// Deterministic portfolio-state reconstruction (docs/data-model.md §0
// "State מחושב, לא מאוחסן"). This is THE core calculation the whole
// product's Portfolio/Position concept rests on — no AI involvement,
// pure arithmetic over Transaction + PortfolioOpeningState.
//
// computePositions() is a pure function (no DB access) so it's cheap to
// unit test exhaustively per CLAUDE.md's Definition of Done ("cost-basis
// reconstruction" is explicitly named). computePositionsForInvestor()
// below is the thin DB-fetching wrapper real callers use.
//
// Cost basis method: Average Cost, not FIFO (docs/data-model.md §6 — this
// product isn't for tax reporting). Numbers are plain JS `number`, not an
// arbitrary-precision decimal type: this is a personal decision-support
// tool, not a ledger of record, and float64 has 15+ significant digits —
// comfortably precise for portfolio sizes this product will ever see.

export type CostBasisConfidence = "known" | "approximate" | "unknown";

export type TransactionType = "buy" | "sell" | "dividend" | "deposit" | "withdrawal" | "fee";

export interface TransactionInput {
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
}

const QUANTITY_EPSILON = 1e-9;

interface TickerAccumulator {
  quantity: number;
  totalCostBasis: number;
  confidence: CostBasisConfidence;
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

  for (const os of openingStates) {
    if (!withinCutoff(os.asOfDate)) continue;
    const costBasisPerShare = os.costBasisPerShare ?? 0;
    byTicker.set(os.ticker, {
      quantity: os.quantity,
      totalCostBasis: costBasisPerShare * os.quantity,
      confidence: os.costBasisConfidence,
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
      };
      existing.quantity += qty;
      existing.totalCostBasis += qty * price;
      byTicker.set(txn.ticker, existing);
    } else if (txn.transactionType === "sell") {
      const qty = txn.quantity ?? 0;
      const existing = byTicker.get(txn.ticker);

      if (!existing || existing.quantity < qty - QUANTITY_EPSILON) {
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
        existing.quantity -= qty;
        existing.totalCostBasis -= avgCostPerShare * qty;
        if (existing.quantity < QUANTITY_EPSILON) {
          existing.quantity = 0;
          existing.totalCostBasis = 0;
        }
        byTicker.set(txn.ticker, existing);
      }
      // If there's no `existing` entry at all, there's nothing to reduce —
      // the warning above already flags it; we don't fabricate a negative
      // holding.
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

  return { asOfDate: asOfDate ?? new Date(), cash, positions, warnings };
}
