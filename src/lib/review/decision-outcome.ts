// Outcome — pure code, never AI (docs/architecture.md §2.7: "Outcome —
// קוד טהור"). Deliberately produces plain facts (price then vs now, $
// P&L if a size was recorded) with no judgment about whether the
// decision was "good" — that's what the 7 ReviewDimension verdicts and
// decision_quality_overall are for, computed separately (Separate Skill
// From Luck: outcome and process quality are not the same axis).
//
// For a PASS decision specifically, this same shape of number ("price
// moved X% since you passed") *is* the counterfactual — CLAUDE.md's
// Counterfactual Learning principle requires it stay Pull, never Push,
// so the caller (the tRPC router / UI) is responsible for gating a
// PASS's outcome behind an explicit "Show what happened since" action
// rather than surfacing it by default; this function itself is neutral
// and computes the same thing for every decision type.

const QUANTITY_EPSILON = 1e-9;

export interface DecisionOutcomeInput {
  priceAtDecision: number;
  /** Dollar amount recorded on the DecisionSnapshot, if any (BUY/ADD typically have one; PASS never does). */
  sizeDollars: number | null;
  /** Current market price for the ticker, or null if genuinely unavailable right now. */
  currentPrice: number | null;
  /** Current live-computed holding quantity for this ticker (0 if not currently held). */
  currentlyHeldQuantity: number;
  asOfDate: Date;
}

export interface DecisionOutcome {
  priceAtDecision: number;
  currentPrice: number | null;
  /** (currentPrice - priceAtDecision) / priceAtDecision * 100 — null if currentPrice is unavailable or priceAtDecision is 0. */
  priceChangePercent: number | null;
  sizeDollars: number | null;
  /** What the recorded size would be worth now, scaled by the same price move — null unless both sizeDollars and currentPrice are known. */
  positionValueNowUsd: number | null;
  pnlUsd: number | null;
  pnlPercent: number | null;
  stillHeld: boolean;
  asOfDate: string; // ISO — round-trips through jsonb as a string anyway
}

export function computeDecisionOutcome(input: DecisionOutcomeInput): DecisionOutcome {
  const priceChangePercent =
    input.currentPrice !== null && input.priceAtDecision !== 0
      ? ((input.currentPrice - input.priceAtDecision) / input.priceAtDecision) * 100
      : null;

  let positionValueNowUsd: number | null = null;
  let pnlUsd: number | null = null;
  let pnlPercent: number | null = null;

  if (input.sizeDollars !== null && input.currentPrice !== null && input.priceAtDecision !== 0) {
    positionValueNowUsd = input.sizeDollars * (input.currentPrice / input.priceAtDecision);
    pnlUsd = positionValueNowUsd - input.sizeDollars;
    pnlPercent = priceChangePercent; // same %, by construction, for a fixed share count under average cost
  }

  return {
    priceAtDecision: input.priceAtDecision,
    currentPrice: input.currentPrice,
    priceChangePercent,
    sizeDollars: input.sizeDollars,
    positionValueNowUsd,
    pnlUsd,
    pnlPercent,
    stillHeld: input.currentlyHeldQuantity > QUANTITY_EPSILON,
    asOfDate: input.asOfDate.toISOString(),
  };
}
