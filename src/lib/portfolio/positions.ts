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
  /**
   * Same-day ordering (Investment Episode Independence design's "ordering
   * contract") — both optional, both read only by deriveEpisodeKeys()
   * below, never by the accumulator above. Absent/null means "no
   * declared order" — indistinguishable from a genuine
   * orderUnknownReason for episode-derivation purposes (§5: both non-null
   * reasons are treated identically; a caller that doesn't care about
   * episodes at all, e.g. import.ts's pre-insert validate() dry run, can
   * simply omit both).
   */
  intraDayOrder?: number | null;
  orderUnknownReason?: "user_declared" | "never_recorded" | null;
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
  /**
   * Investment Episode Independence design — a fresh, in-memory-only,
   * per-call map from transaction id to an "episode key": transactions
   * belonging to the same continuous open-to-flat position lifecycle
   * share one key. Consumed by src/lib/evidence/build-answer-case-keys.ts
   * so DNA/Strategy evidence counting treats one real position's several
   * transactions (e.g. BUY, partial SELL, final SELL) as ONE independent
   * case, not several — never by anything else here. Entries exist only
   * for transactions that (a) have a real ticker, (b) are buy/sell, and
   * (c) carry an `id` (TransactionInput.id is optional; a caller with no
   * ids, e.g. import.ts's pre-insert validate() dry run, simply gets no
   * entries — harmless, since nothing looks those up). See
   * deriveEpisodeKeys()'s own comment, further down this file, for the
   * full algorithm and scope boundary — this field is populated from
   * that function and never influences quantity/costBasis/sellTrace/
   * warnings/positions above it, only the reverse (this reads the same
   * sorted transaction data, nothing more).
   */
  episodeKeyByTransactionId: Map<string, string>;
}

// Exported (not just a local const) because it's part of the shared
// quantity-transition contract below — deriveEpisodeKeys() (Investment
// Episode Independence design, same file, further down) compares against
// this exact same threshold rather than redefining its own, so "closed"
// always means the same thing everywhere in the codebase.
export const QUANTITY_EPSILON = 1e-9;
const MS_PER_DAY = 86_400_000;

export interface QuantityTransition {
  transactionType: "buy" | "sell";
  /** Always positive — direction comes from transactionType, not sign. */
  quantity: number;
}

// THE one place the buy/sell quantity-clamp rule is implemented (Investment
// Episode Independence design §6 — "the real quantity-transition rule,
// used everywhere, exactly"). computePositions()'s own accumulator below
// calls this for its quantity bookkeeping; deriveEpisodeKeys() (further
// down this file) calls the exact same function for its ceiling/exactKnown
// arithmetic. This is the ONLY thing the two mechanisms share — cost
// basis, confidence, sellTrace, and episode state are computed
// independently of one another (see deriveEpisodeKeys()'s own comment for
// the full scope boundary). A buy always adds exactly; a sell subtracts
// and then resets to exactly 0 whenever the result is strictly less than
// QUANTITY_EPSILON (not <=) — an oversell or a near-zero dust residual are
// both treated as fully closed, exactly as they always have been here.
export function applyTransactionToQuantity(quantity: number, txn: QuantityTransition): number {
  if (txn.transactionType === "buy") {
    return quantity + txn.quantity;
  }
  const result = quantity - txn.quantity;
  return result < QUANTITY_EPSILON ? 0 : result;
}

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
      existing.quantity = applyTransactionToQuantity(existing.quantity, {
        transactionType: "buy",
        quantity: qty,
      });
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

        existing.totalCostBasis -= avgCostPerShare * qty;
        existing.quantity = applyTransactionToQuantity(existing.quantity, {
          transactionType: "sell",
          quantity: qty,
        });
        if (existing.quantity === 0) {
          // Either an exact close or the clamp fired (applyTransactionToQuantity's
          // only way to return exactly 0) — either way, matches the original
          // `< QUANTITY_EPSILON` check this replaced exactly.
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

  // Separate computation, sharing only applyTransactionToQuantity() above
  // (§11 "Scope boundary" of the Investment Episode Independence design)
  // — reads the same sortedTxns/openingStates this function already has
  // in hand, writes nothing back into quantity/totalCostBasis/warnings/
  // sellTrace/positions computed above.
  const episodeKeyByTransactionId = deriveEpisodeKeys(sortedTxns, openingStates);

  return { asOfDate: asOfDate ?? new Date(), cash, positions, warnings, sellTrace, episodeKeyByTransactionId };
}

// ---------------------------------------------------------------------
// Evidence-episode derivation (Investment Episode Independence design —
// planning doc, this session). Answers one question only: which
// transactions belong to the same continuous open-to-flat investment
// lifecycle, so DNA/Strategy evidence counting (countIndependentCases)
// treats them as one independent case instead of several. This is a
// SEPARATE computation from the accumulator above — see the scope
// boundary below — sharing only applyTransactionToQuantity()/
// QUANTITY_EPSILON. It never changes displayed quantity, cost basis,
// realized P&L, sellTrace, warnings, or positions; information flows one
// way only (real transaction data -> episode grouping, never back), and
// this never asserts a canonical physical transaction order for display
// purposes — only for evidence-case bookkeeping.
//
// Per-ticker, fully independent (no state crosses tickers). Fresh,
// in-memory, pure per call — computed, not stored, exactly like the
// accumulator above; never revisits or rewrites an already-persisted
// Evidence/DNAHypothesisVersion/StrategyPrincipleVersion row (those stay
// append-only). A later call simply recomputes the whole map from
// scratch, consistent with "computed, not stored."
//
// The model: two numbers per ticker, `ceiling` and `exactKnown`.
// `ceiling` is a PROVEN upper bound on true quantity (trueQty <= ceiling
// always — simple induction: a buy adds exactly, a sell/clamp never
// increases quantity, every reachable quantity is >= 0). `exactKnown` is
// the true value, tracked only while no ambiguity has occurred since it
// was last known for certain.
//
// Group resolvability (same-exact-timestamp transactions): a group
// resolves EXACTLY when it's (a) a single transaction, (b) every member
// has a distinct declared intraDayOrder (processed in that order), or
// (c) it has zero buys — an all-sell group's result depends only on the
// total sold, never the split among individual sells (same-direction
// transactions commute). A same-day all-BUY group with no declared order
// is deliberately NOT special-cased the same way even though buys also
// commute among themselves — treating it as an ordinary unresolved group
// (below) is strictly conservative (it can only destroy exactness it
// could safely have kept, never assert anything unsound), which is an
// intentional, disclosed under-precision, not a bug (design's Non-goals).
// Anything else (ambiguous — more than one member, no declared order,
// at least one buy) only ever accumulates its buys onto `ceiling`
// (`ceiling += sum of buys in the group`) and nulls `exactKnown` — never
// credits any sell reduction, since crediting one would assume a specific
// order. `ceiling <= EPSILON` always proves closed, regardless of
// whether the input was exact or ceiling-only. `ceiling > EPSILON` never
// proves open. `exactKnown` is restored from null only when a known-order
// computation applied to `ceiling` returns EXACTLY 0 (sandwiched between
// the proven `trueQty <= 0` and the separately-proven `trueQty >= 0`). A
// new episode is proven only from a genuinely exact chain crossing
// > EPSILON — never from `ceiling` alone; no lower bound is used or
// required.
//
// Key assignment is retrospective/run-based: while "closed" (no live
// episode), transactions are buffered into a pending run rather than
// keyed immediately. The run resolves the moment either (a) an exact
// computation proves a crossing to > EPSILON — every buffered transaction
// PLUS the crossing one gets one new episode key, and processing
// continues live from there — or (b) ceiling drops back to <= EPSILON
// after having genuinely exceeded EPSILON since the run began — the whole
// buffer merges into the run's fallback target and buffering starts
// fresh (still "closed", same fallback target, same next-candidate
// key — an unresolved dip that never exceeded EPSILON, e.g. a small buy
// sitting at/under EPSILON, is NOT treated as a fresh resolution event:
// it keeps buffering). If chronology ends while still buffered, the
// remainder merges the same way. The ticker's very first run (before any
// real episode has ever closed) has no real prior episode to fall back
// to, so its fallback target IS its own first candidate key
// ("TICKER#1") — both the "never opens" and "opens" outcomes converge on
// the same key for that specific run; every subsequent run's fallback is
// the real key that closed immediately before it began, distinct from
// its own opening candidate. (This exact behavior — including for a
// first run that closes-then-reopens, which DOES split into two keys,
// consistent with every later run — was confirmed against the locked
// design's own worked traces before implementation; see this session's
// implementation report for the one genuine cross-trace inconsistency
// found and resolved this way.)
export type OrderUnknownReason = "user_declared" | "never_recorded";

interface EpisodeStep {
  ids: string[];
  // Present for an exactly-resolvable step (single transaction, one
  // member of a declared-order sequence, or a whole zero-buy group
  // collapsed to its net sell). Absent for an unresolved/ambiguous group,
  // which instead only ever contributes `buySum` to `ceiling`.
  transition?: QuantityTransition;
  buySum?: number;
}

function classifyGroupIntoSteps(members: TransactionInput[]): EpisodeStep[] {
  if (members.length === 1) {
    const m = members[0]!;
    return [
      {
        ids: [m.id!],
        transition: { transactionType: m.transactionType as "buy" | "sell", quantity: m.quantity ?? 0 },
      },
    ];
  }

  const orders = members.map((m) => m.intraDayOrder ?? null);
  const allDeclared = orders.every((o) => o !== null) && new Set(orders).size === orders.length;
  if (allDeclared) {
    const sorted = [...members].sort((a, b) => (a.intraDayOrder ?? 0) - (b.intraDayOrder ?? 0));
    return sorted.map((m) => ({
      ids: [m.id!],
      transition: { transactionType: m.transactionType as "buy" | "sell", quantity: m.quantity ?? 0 },
    }));
  }

  const allSells = members.every((m) => m.transactionType === "sell");
  if (allSells) {
    const totalSell = members.reduce((sum, m) => sum + (m.quantity ?? 0), 0);
    return [{ ids: members.map((m) => m.id!), transition: { transactionType: "sell", quantity: totalSell } }];
  }

  const buySum = members
    .filter((m) => m.transactionType === "buy")
    .reduce((sum, m) => sum + (m.quantity ?? 0), 0);
  return [{ ids: members.map((m) => m.id!), buySum }];
}

function deriveEpisodeKeysForTicker(
  ticker: string,
  txns: TransactionInput[],
  startQty: number,
  result: Map<string, string>
): void {
  let mode: "open" | "closed-pending" = startQty > QUANTITY_EPSILON ? "open" : "closed-pending";
  let ceiling = startQty;
  let exactKnown: number | null = startQty;
  // The number of the last episode actually minted for real (0 = none
  // yet). A run's fallback-if-never-opens target and next-candidate-
  // if-opens key are both always derivable from this one counter — see
  // the module comment above for why they never need separate storage.
  let episodeCounter = mode === "open" ? 1 : 0;
  let liveEpisodeNumber = mode === "open" ? 1 : 0;
  let pendingRun: string[] = [];

  const keyFor = (n: number) => `${ticker}#${n}`;
  const assign = (ids: string[], n: number) => {
    for (const id of ids) result.set(id, keyFor(n));
  };

  // Group by exact transactionDate equality — the same granularity the
  // ordering-contract migration's partial unique index and backfill use.
  const groups: TransactionInput[][] = [];
  for (const t of txns) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.transactionDate.getTime() === t.transactionDate.getTime()) {
      last.push(t);
    } else {
      groups.push([t]);
    }
  }

  for (const group of groups) {
    for (const step of classifyGroupIntoSteps(group)) {
      const ceilingBefore = ceiling;

      if (step.transition) {
        const input = exactKnown ?? ceiling;
        const output = applyTransactionToQuantity(input, step.transition);
        if (exactKnown !== null) {
          exactKnown = output;
          ceiling = output;
        } else {
          ceiling = output;
          if (output === 0) exactKnown = 0; // singleton restoration (§9)
        }
      } else {
        ceiling = ceiling + (step.buySum ?? 0);
        exactKnown = null;
      }

      if (mode === "open") {
        assign(step.ids, liveEpisodeNumber);
        if (ceiling <= QUANTITY_EPSILON) {
          // Proven closed — leave "open," start a fresh pending run.
          mode = "closed-pending";
          pendingRun = [];
          ceiling = 0;
          exactKnown = 0;
        }
      } else {
        pendingRun.push(...step.ids);
        if (exactKnown !== null && exactKnown > QUANTITY_EPSILON) {
          // Proven opening: mint the next key, assign it to everything
          // buffered since the last close (including this crossing
          // step), and go live.
          episodeCounter += 1;
          liveEpisodeNumber = episodeCounter;
          assign(pendingRun, liveEpisodeNumber);
          pendingRun = [];
          mode = "open";
        } else if (ceiling <= QUANTITY_EPSILON && ceilingBefore > QUANTITY_EPSILON) {
          // Reaches another proven closure without ever proving a
          // crossing: merge the whole buffered run into its fallback
          // target. The very first run's fallback is its own key
          // ("TICKER#1", episodeCounter still 0 at this point); every
          // later run's fallback is the real episode that closed right
          // before it began (already reflected in episodeCounter).
          const fallbackNumber = Math.max(episodeCounter, 1);
          assign(pendingRun, fallbackNumber);
          episodeCounter = fallbackNumber;
          pendingRun = [];
        }
        // else: genuinely still unresolved, or a dip that never actually
        // exceeded EPSILON since the run began — keep buffering.
      }
    }
  }

  // Chronology ends while still buffered: the run never proved it
  // opened, so it all merges into its fallback target, same rule as an
  // interior re-closure above.
  if (mode === "closed-pending" && pendingRun.length > 0) {
    assign(pendingRun, Math.max(episodeCounter, 1));
  }
}

function deriveEpisodeKeys(
  sortedTxns: TransactionInput[],
  openingStates: OpeningStateInput[]
): Map<string, string> {
  const result = new Map<string, string>();

  const byTicker = new Map<string, TransactionInput[]>();
  for (const t of sortedTxns) {
    if (!t.ticker || t.id === undefined) continue;
    if (t.transactionType !== "buy" && t.transactionType !== "sell") continue;
    const list = byTicker.get(t.ticker) ?? [];
    list.push(t);
    byTicker.set(t.ticker, list);
  }

  const openingByTicker = new Map(openingStates.map((o) => [o.ticker, o.quantity]));

  for (const [ticker, txns] of byTicker) {
    // sortedTxns is already date-sorted by the caller; stable per-ticker
    // filter above preserves that order.
    deriveEpisodeKeysForTicker(ticker, txns, openingByTicker.get(ticker) ?? 0, result);
  }

  return result;
}
