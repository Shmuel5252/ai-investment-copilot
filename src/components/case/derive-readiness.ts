// "לפני הרישום" — a plain inventory over state that already exists. No score,
// no weighting, no order of merit. The rules mirror exactly what
// decisions.create refuses without (status, an approved Strategy version, the
// reasoning text, an explicit review horizon); the inventory mirrors the
// research steps this page offers. Nothing here is a judgment about whether
// the investor should decide.

export type RuleKey = "researching" | "strategy" | "reasoning" | "horizon";
export type RuleState = "met" | "unmet" | "unknown";
export type InventoryKey = "market" | "portfolioFit" | "personalFit" | "reading";

export interface ReadinessInput {
  status: string;
  /** undefined while strategy.list is loading or failed: not known, never guessed. */
  hasApprovedStrategy: boolean | undefined;
  reasoningText: string;
  reviewHorizon: "" | "date" | "none";
  reviewByDate: string;
  marketFetched: boolean;
  /** Portfolio Fit is never stored: only a computation made in this visit counts. */
  fitComputedThisVisit: boolean;
  personalFitGenerated: boolean;
  readingGenerated: boolean;
}

export interface Readiness {
  rules: { key: RuleKey; state: RuleState }[];
  inventory: { key: InventoryKey; done: boolean }[];
  /** The two conditions the form itself can satisfy: the same test the record button always used. */
  formComplete: boolean;
}

export function isHorizonChosen(reviewHorizon: ReadinessInput["reviewHorizon"], reviewByDate: string): boolean {
  return reviewHorizon === "none" || (reviewHorizon === "date" && reviewByDate !== "");
}

export function deriveReadiness(input: ReadinessInput): Readiness {
  const met = (b: boolean): RuleState => (b ? "met" : "unmet");
  const reasoning = input.reasoningText.trim() !== "";
  const horizon = isHorizonChosen(input.reviewHorizon, input.reviewByDate);
  return {
    rules: [
      { key: "researching", state: met(input.status === "researching") },
      { key: "strategy", state: input.hasApprovedStrategy === undefined ? "unknown" : met(input.hasApprovedStrategy) },
      { key: "reasoning", state: met(reasoning) },
      { key: "horizon", state: met(horizon) },
    ],
    inventory: [
      { key: "market", done: input.marketFetched },
      { key: "portfolioFit", done: input.fitComputedThisVisit },
      { key: "personalFit", done: input.personalFitGenerated },
      { key: "reading", done: input.readingGenerated },
    ],
    formComplete: reasoning && horizon,
  };
}
