// Deterministic Portfolio Fit metrics (docs/data-model.md §0: "computed,
// not stored" — this is the computePortfolioFit() that section names
// explicitly, and it's never persisted, only recomputed live while an
// InvestmentCase is `researching`). Pure function, no DB/network access,
// so it's cheap to unit test exhaustively (Definition of Done names this
// function specifically) — exactly like computePositions() in
// positions.ts, which this builds on rather than re-deriving.
//
// Deliberately does NOT judge "is this concentration too much" against
// any hardcoded percentage threshold — CLAUDE.md's No Fake Certainty
// principle: a number like "20% is too concentrated" would be an
// invented rule, not a fact about this investor. It surfaces the plain
// numbers (existing/projected weight, largest position) and lets AI
// synthesis reason about them against the investor's own *declared*
// Strategy principles, if any — see src/lib/ai/case.ts.

import type { Position, PortfolioState } from "./positions";

export interface PortfolioFitCandidate {
  ticker: string;
  /** Current market price for this ticker — required so an unheld ticker still gets a real projected weight. */
  price: number;
  /** Hypothetical dollar amount being considered for this position, if any. */
  sizeDollars?: number;
}

export interface PortfolioFit {
  totalPortfolioValueUsd: number;
  /** true if any held position's value had to fall back to cost basis because no live price was available for it. */
  totalPortfolioValueApproximate: boolean;
  existingHoldingQuantity: number;
  existingPositionValueUsd: number;
  existingWeightPercent: number;
  projectedPositionValueUsd: number | null;
  projectedWeightPercent: number | null;
  holdingsCount: number;
  largestCurrentPositionTicker: string | null;
  largestCurrentPositionWeightPercent: number | null;
  warnings: string[];
}

function valueOf(position: Position, priceUsed: number): number {
  return position.quantity * priceUsed;
}

export function computePortfolioFit(
  portfolio: PortfolioState,
  currentPricesByTicker: Readonly<Record<string, number>>,
  candidate: PortfolioFitCandidate
): PortfolioFit {
  const warnings: string[] = [];
  let totalPortfolioValueUsd = portfolio.cash;
  let totalPortfolioValueApproximate = false;
  let existingPositionValueUsd = 0;
  let existingHoldingQuantity = 0;
  let largestTicker: string | null = null;
  let largestValue = -Infinity;

  for (const position of portfolio.positions) {
    // The candidate's own live price always wins for its own ticker,
    // never currentPricesByTicker — both real callers
    // (portfolio-fit-for-investor.ts, decisions.ts) deliberately exclude
    // the candidate from that map (it's already been fetched once for
    // the candidate itself; "no reason to fetch it twice", see the
    // comment on computePortfolioFitForInvestor) — so
    // currentPricesByTicker[candidate.ticker] is always undefined in
    // production, and without this, an already-held candidate silently
    // fell back to cost basis despite a real live price sitting in
    // memory (docs/backlog.md — real gap, confirmed against real
    // production call sites, not just this function in isolation).
    const livePrice =
      position.ticker === candidate.ticker
        ? candidate.price
        : currentPricesByTicker[position.ticker];
    const priceUsed = livePrice ?? position.costBasisPerShare ?? 0;
    if (livePrice === undefined) {
      totalPortfolioValueApproximate = true;
      warnings.push(`No live price available for ${position.ticker} — used cost basis instead.`);
    }

    const value = valueOf(position, priceUsed);
    totalPortfolioValueUsd += value;
    if (value > largestValue) {
      largestValue = value;
      largestTicker = position.ticker;
    }
    if (position.ticker === candidate.ticker) {
      existingPositionValueUsd = value;
      existingHoldingQuantity = position.quantity;
    }
  }

  const existingWeightPercent =
    totalPortfolioValueUsd > 0 ? (existingPositionValueUsd / totalPortfolioValueUsd) * 100 : 0;

  let projectedPositionValueUsd: number | null = null;
  let projectedWeightPercent: number | null = null;

  if (candidate.sizeDollars !== undefined) {
    // Modeled as reallocating existing cash into the position, not fresh
    // capital arriving — the portfolio's total value doesn't change,
    // only the position's share of it does. This is also why it's
    // meaningful to flag when the hypothetical size exceeds available cash.
    projectedPositionValueUsd = existingPositionValueUsd + candidate.sizeDollars;
    projectedWeightPercent =
      totalPortfolioValueUsd > 0 ? (projectedPositionValueUsd / totalPortfolioValueUsd) * 100 : 0;

    if (candidate.sizeDollars > portfolio.cash) {
      warnings.push(
        `Hypothetical size ($${candidate.sizeDollars.toFixed(2)}) exceeds available cash ($${portfolio.cash.toFixed(2)}) — this would require selling other holdings or adding funds.`
      );
    }

    if (
      projectedPositionValueUsd > largestValue &&
      largestTicker !== null &&
      largestTicker !== candidate.ticker
    ) {
      warnings.push(`This would become the largest position in the portfolio, ahead of ${largestTicker}.`);
    }
  }

  const largestCurrentPositionWeightPercent =
    largestTicker !== null && totalPortfolioValueUsd > 0 ? (largestValue / totalPortfolioValueUsd) * 100 : null;

  return {
    totalPortfolioValueUsd,
    totalPortfolioValueApproximate,
    existingHoldingQuantity,
    existingPositionValueUsd,
    existingWeightPercent,
    projectedPositionValueUsd,
    projectedWeightPercent,
    holdingsCount: portfolio.positions.length,
    largestCurrentPositionTicker: largestTicker,
    largestCurrentPositionWeightPercent,
    warnings,
  };
}
