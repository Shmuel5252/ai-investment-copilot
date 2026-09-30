import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import type { Loadable } from "@/components/home/types";
import type { ExecutionData, Candidate } from "@/components/execution-facts";
import type { ConditionActions } from "@/components/reentry-condition";

// The shapes the Decision record reads, narrowed from the existing procedures
// to the fields the page shows, so the /styleguide preview builds the same
// props without inventing columns. Dates arrive as ISO strings.
type Out = inferRouterOutputs<AppRouter>;
type Get = Out["decisions"]["get"];
type Snapshot = NonNullable<Get["snapshot"]>;

export type DecisionRow = Pick<Get["decision"], "id" | "ticker" | "decisionType" | "decisionDate" | "reviewByDate" | "investmentCaseId">;
export type SnapshotRow = Pick<
  Snapshot,
  | "createdAt"
  | "priceAtDecision"
  | "size"
  | "userReasoningText"
  | "aiRealtimeAssessmentText"
  | "risksConsideredText"
  | "exitConditionsText"
  | "portfolioStateJson"
  | "strategyVersionId"
  | "investmentCaseSnapshotJson"
  | "priorRecordJson"
> & {
  thesis: { aiInterpretationText: string | null } | null;
  dnaReferences: { dnaHypothesisVersionId: string; dnaHypothesisVersion: { statementText: string; evidenceStrength: string | null } }[];
};
export type PredictionRow = Pick<Get["predictions"][number], "id" | "claimText" | "kind" | "status" | "checkableByDate" | "resolvedAt" | "resolutionNote" | "resolvedByReviewId">;
export type MarketContextRow = Pick<NonNullable<Get["marketContext"]>, "capturedAt" | "indexLevel" | "indexChange1d" | "volatilityIndexValue">;

export interface DecisionRecord {
  decision: DecisionRow;
  snapshot: SnapshotRow | null;
  predictions: PredictionRow[];
  marketContext: MarketContextRow | null;
}

type ReviewOut = Out["reviews"]["listForDecision"][number];
export type ReviewRow = Pick<ReviewOut, "id" | "reviewDate" | "narrativeSummaryText" | "decisionQualityOverall" | "thesisAccuracy" | "outcomeJson"> & {
  dimensions: Pick<ReviewOut["dimensions"][number], "id" | "dimension" | "verdict" | "rationaleText" | "citedSnapshotFields">[];
};
export type LaterContextRow = Pick<Out["decisions"]["listLaterContext"][number], "id" | "addedAt" | "text" | "addedBy">;
type Attention = Out["decisions"]["attention"];
export type MonitoringItem = Pick<Attention["items"][number], "decisionId" | "state" | "horizon" | "predictions" | "position">;
export interface TodayData {
  item: MonitoringItem | null;
  historyThrough: Attention["historyThrough"];
}
export type PendingPrediction = Pick<Out["reviews"]["pendingPredictions"][number], "id" | "claimText" | "kind">;

// Frozen shapes read out of jsonb columns.
export interface FrozenPortfolioState {
  cash: number;
  positions: { ticker: string; quantity: number; costBasisPerShare: number | null }[];
}
export interface FrozenCaseCopy {
  marketIntelligenceJson?: { companyName?: string; sector?: string | null; industry?: string | null; price?: number; fetchedAt?: string } | null;
  synthesisText?: string | null;
  bullCaseText?: string | null;
  bearCaseText?: string | null;
  catalystsText?: string | null;
  invalidationConditionsText?: string | null;
  marketBlindspotText?: string | null;
  devilsAdvocateText?: string | null;
  personalFitText?: string | null;
  portfolioFitText?: string | null;
}
export interface ReviewOutcome {
  priceAtDecision: number;
  currentPrice: number | null;
  priceChangePercent: number | null;
  sizeDollars: number | null;
  positionValueNowUsd: number | null;
  pnlUsd: number | null;
  pnlPercent: number | null;
  stillHeld: boolean;
  asOfDate: string;
}

// A mutation as the view sees it. `run` resolves true when the write was
// saved, so the view can clear its own draft only then.
export interface DecisionAction<A extends unknown[]> {
  run: (...args: A) => Promise<boolean>;
  pending: boolean;
  error: string | null;
}
export interface Resolution {
  predictionId: string;
  status: "confirmed" | "refuted" | "inconclusive";
  note: string;
}

export interface DecisionViewData {
  record: Loadable<DecisionRecord>;
  reviews: Loadable<ReviewRow[]>;
  pendingPredictions: Loadable<PendingPrediction[]>;
  laterContexts: Loadable<LaterContextRow[]>;
  today: Loadable<TodayData>;
  execution: Loadable<ExecutionData>;
  /** The current approved Strategy version id (strategy.list), to say whether the frozen one is still current. */
  currentStrategyVersionId: Loadable<string | null>;
  /** Cases opened from this decision's conditions (cases.list rows with originPredictionId). */
  reconsiderationCases: { id: string; originPredictionId: string }[];
}

export interface DecisionViewActions {
  setReviewDate: DecisionAction<[date: string]>;
  addLaterContext: DecisionAction<[text: string]>;
  runReview: DecisionAction<[resolutions: Resolution[]]>;
  disagree: DecisionAction<[dimensionId: string, text: string]>;
  markExecution: { run: (c: Candidate, verdict: "executed" | "unrelated") => void; pending: boolean; error: string | null };
  conditions: ConditionActions;
}
