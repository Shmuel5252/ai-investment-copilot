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
// numbers (existing/projected weight, largest position, sector/industry
// exposure) and lets AI synthesis reason about them against the
// investor's own *declared* Strategy principles, if any — see
// src/lib/ai/case.ts.

import type { Position, PortfolioState } from "./positions";

export interface PortfolioFitCandidate {
  ticker: string;
  /** Current market price for this ticker — required so an unheld ticker still gets a real projected weight. */
  price: number;
  /** Hypothetical dollar amount being considered for this position, if any. */
  sizeDollars?: number;
  /**
   * The candidate's own sector/industry, from the same MarketIntelligence
   * the caller already fetched for its price — required, not optional
   * (docs/backlog.md, Sector/Industry Exposure): every caller must
   * decide explicitly what this candidate's classification is, the same
   * way `price` is already required for the same reason. `null` means
   * FMP genuinely has no sector/industry on file for this ticker — a
   * real, distinct fact, not "caller forgot to pass it".
   */
  sector: string | null;
  industry: string | null;
}

// A held ticker's sector+industry, both from the same MarketIntelligence
// fetch — one combined shape, not two parallel maps, since the two
// values always come from the same source per ticker (docs/backlog.md).
export interface TickerClassification {
  sector: string | null;
  industry: string | null;
}

export interface SectorExposureEntry {
  /** null = Unclassified Holding — no sector data available, never cash. */
  sector: string | null;
  valueUsd: number;
  /** Against totalPortfolioValueUsd (includes cash) — same denominator as existingWeightPercent. Buckets do NOT sum to 100% when cash > 0; see cashWeightPercent. */
  weightPercent: number;
}

export interface IndustryExposureEntry {
  /** null = Unclassified Holding — no industry data available, never cash. */
  industry: string | null;
  valueUsd: number;
  weightPercent: number;
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

  /** Cash is never a sector/industry classification and never lands in a null (Unclassified) bucket — it's its own concept. */
  cashValueUsd: number;
  cashWeightPercent: number;

  sectorExposure: SectorExposureEntry[];
  industryExposure: IndustryExposureEntry[];

  /**
   * Completes the existing "reallocating existing cash into the
   * position" model (see the sizeDollars block below) for cash/exposure:
   * null when candidate.sizeDollars is undefined — same null-when-no-
   * hypothetical-size pattern as projectedPositionValueUsd/
   * projectedWeightPercent above. Deliberately NOT null just because
   * sizeDollars is 0 — 0 is a defined hypothetical ("what if I add
   * nothing"), and the projected fields then equal the current ones,
   * not absent (docs/backlog.md).
   */
  projectedCashValueUsd: number | null;
  projectedCashWeightPercent: number | null;
  projectedSectorExposure: SectorExposureEntry[] | null;
  projectedIndustryExposure: IndustryExposureEntry[] | null;
}

function valueOf(position: Position, priceUsed: number): number {
  return position.quantity * priceUsed;
}

function addToBucket(map: Map<string | null, number>, key: string | null, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function toSectorEntries(map: ReadonlyMap<string | null, number>, totalPortfolioValueUsd: number): SectorExposureEntry[] {
  return [...map.entries()].map(([sector, valueUsd]) => ({
    sector,
    valueUsd,
    weightPercent: totalPortfolioValueUsd > 0 ? (valueUsd / totalPortfolioValueUsd) * 100 : 0,
  }));
}

function toIndustryEntries(map: ReadonlyMap<string | null, number>, totalPortfolioValueUsd: number): IndustryExposureEntry[] {
  return [...map.entries()].map(([industry, valueUsd]) => ({
    industry,
    valueUsd,
    weightPercent: totalPortfolioValueUsd > 0 ? (valueUsd / totalPortfolioValueUsd) * 100 : 0,
  }));
}

export function computePortfolioFit(
  portfolio: PortfolioState,
  currentPricesByTicker: Readonly<Record<string, number>>,
  candidate: PortfolioFitCandidate,
  classificationByTicker: Readonly<Record<string, TickerClassification>>
): PortfolioFit {
  const warnings: string[] = [];
  let totalPortfolioValueUsd = portfolio.cash;
  let totalPortfolioValueApproximate = false;
  let existingPositionValueUsd = 0;
  let existingHoldingQuantity = 0;
  let largestTicker: string | null = null;
  let largestValue = -Infinity;

  const sectorValueByKey = new Map<string | null, number>();
  const industryValueByKey = new Map<string | null, number>();

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

    // Same precedence as price above, for the same reason: the
    // candidate's own fresh classification always wins for its own
    // ticker, never classificationByTicker — both real callers already
    // exclude the candidate from that map. This is a defensive
    // invariant on the pure function itself (docs/backlog.md), not
    // reliance on caller discipline — so the same ticker can never show
    // up under two different classifications within one breakdown.
    // Missing/null classification (either source) falls into the
    // Unclassified (null) bucket, never silently dropped.
    const classification =
      position.ticker === candidate.ticker
        ? { sector: candidate.sector, industry: candidate.industry }
        : (classificationByTicker[position.ticker] ?? { sector: null, industry: null });
    addToBucket(sectorValueByKey, classification.sector, value);
    addToBucket(industryValueByKey, classification.industry, value);
  }

  const existingWeightPercent =
    totalPortfolioValueUsd > 0 ? (existingPositionValueUsd / totalPortfolioValueUsd) * 100 : 0;

  const cashValueUsd = portfolio.cash;
  const cashWeightPercent = totalPortfolioValueUsd > 0 ? (cashValueUsd / totalPortfolioValueUsd) * 100 : 0;

  const sectorExposure = toSectorEntries(sectorValueByKey, totalPortfolioValueUsd);
  const industryExposure = toIndustryEntries(industryValueByKey, totalPortfolioValueUsd);

  let projectedPositionValueUsd: number | null = null;
  let projectedWeightPercent: number | null = null;
  let projectedCashValueUsd: number | null = null;
  let projectedCashWeightPercent: number | null = null;
  let projectedSectorExposure: SectorExposureEntry[] | null = null;
  let projectedIndustryExposure: IndustryExposureEntry[] | null = null;

  if (candidate.sizeDollars !== undefined) {
    // Modeled as reallocating existing cash into the position, not fresh
    // capital arriving — the portfolio's total value doesn't change,
    // only the position's share of it does. This is also why it's
    // meaningful to flag when the hypothetical size exceeds available cash.
    projectedPositionValueUsd = existingPositionValueUsd + candidate.sizeDollars;
    projectedWeightPercent =
      totalPortfolioValueUsd > 0 ? (projectedPositionValueUsd / totalPortfolioValueUsd) * 100 : 0;

    // Completes the same reallocation model above for cash and exposure:
    // cash funds the hypothetical addition, so it drops by exactly
    // sizeDollars — deliberately NOT clamped to 0 (docs/backlog.md): if
    // sizeDollars exceeds available cash, this goes negative, an honest
    // reflection of exactly what the warning below already says in
    // words ("would require selling other holdings or adding funds"),
    // not a bug to paper over with an invented floor.
    projectedCashValueUsd = portfolio.cash - candidate.sizeDollars;
    projectedCashWeightPercent =
      totalPortfolioValueUsd > 0 ? (projectedCashValueUsd / totalPortfolioValueUsd) * 100 : 0;

    // Two separate questions, not one (docs/backlog.md — external review
    // caught this): "does a projected state exist" is
    // `sizeDollars !== undefined` (the outer `if` above) — sizeDollars=0
    // is a defined hypothetical and must still produce a non-null
    // projected state. But "is there a real amount to add to a
    // classification bucket" is `sizeDollars !== 0` — addToBucket()
    // unconditionally does map.set(key, (map.get(key) ?? 0) + amount),
    // so calling it with amount=0 for a candidate.sector/industry key
    // that isn't already in the map (e.g. a brand-new unheld candidate,
    // or one with sector=null) would silently materialize a spurious
    // zero-value bucket (e.g. "Unclassified 0.0%") that current exposure
    // never had — a real holding lacking classification data and a
    // candidate that was allocated nothing are different facts and must
    // not collapse into the same bucket. Guarding the addToBucket calls
    // (not the sizeDollars!==undefined check above) keeps sizeDollars=0
    // a defined, non-null projected state that's simply identical to
    // current — not absent.
    const projectedSectorMap = new Map(sectorValueByKey);
    if (candidate.sizeDollars !== 0) {
      addToBucket(projectedSectorMap, candidate.sector, candidate.sizeDollars);
    }
    projectedSectorExposure = toSectorEntries(projectedSectorMap, totalPortfolioValueUsd);

    const projectedIndustryMap = new Map(industryValueByKey);
    if (candidate.sizeDollars !== 0) {
      addToBucket(projectedIndustryMap, candidate.industry, candidate.sizeDollars);
    }
    projectedIndustryExposure = toIndustryEntries(projectedIndustryMap, totalPortfolioValueUsd);

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
    cashValueUsd,
    cashWeightPercent,
    sectorExposure,
    industryExposure,
    projectedCashValueUsd,
    projectedCashWeightPercent,
    projectedSectorExposure,
    projectedIndustryExposure,
  };
}
