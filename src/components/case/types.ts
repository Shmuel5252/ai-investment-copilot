import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import type { PortfolioFit } from "@/lib/portfolio/portfolio-fit";
import type { PriorRecordBrief } from "@/lib/prior-record/prior-record";
import type { Loadable } from "@/components/home/types";

// The shapes the Case page reads, taken from the existing procedures. Narrow
// Picks where a procedure returns a whole row, so the synthetic preview in
// /styleguide builds the same props without inventing columns.
type Out = inferRouterOutputs<AppRouter>;

export type CaseData = Pick<
  Out["cases"]["get"],
  | "id"
  | "ticker"
  | "ideaId"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "marketIntelligenceJson"
  | "personalFitText"
  | "personalFitEvidenceRefs"
  | "portfolioFitText"
  | "bullCaseText"
  | "bearCaseText"
  | "catalystsText"
  | "invalidationConditionsText"
  | "marketBlindspotText"
  | "devilsAdvocateText"
  | "synthesisText"
>;
export type IdeaData = Pick<Out["ideas"]["list"][number], "id" | "ticker" | "noteText" | "createdAt">;
export type OriginData = Pick<
  NonNullable<Out["cases"]["originCondition"]>,
  "claimText" | "decisionId" | "decisionType" | "decisionDate" | "ticker" | "resolutionNote"
>;
export type ProfileItem = { id: string; statementText: string | undefined; evidenceStrength: string | undefined };
export type ExistingDecision = { id: string; decisionType: string; decisionDate: string | Date };
export type CaseListRow = Pick<Out["cases"]["list"][number], "id" | "ticker" | "status" | "createdAt" | "updatedAt">;

export interface PersonalFitEvidenceRefs {
  dnaHypothesisIds: string[];
  strategyPrincipleIds: string[];
  hasTraceableEvidence: boolean;
}

// A mutation as a region sees it: run it, is it running, did it fail.
export interface CaseAction<A extends unknown[] = []> {
  run: (...args: A) => void;
  pending: boolean;
  error: string | null;
}

export interface RecordInput {
  decisionType: "BUY" | "ADD" | "HOLD" | "REDUCE" | "SELL" | "PASS";
  sizeDollars: number | undefined;
  reasoningText: string;
  risksConsideredText: string | undefined;
  exitConditionsText: string | undefined;
  reviewHorizon: { choice: "date"; reviewByDate: Date } | { choice: "none" };
}

export interface CaseViewData {
  investmentCase: Loadable<CaseData | null>;
  /** The idea list, read only to find this case's own idea (ideas.list). */
  ideas: Loadable<IdeaData[]>;
  origin: Loadable<OriginData | null>;
  priorRecord: Loadable<PriorRecordBrief>;
  dna: Loadable<ProfileItem[]>;
  strategy: Loadable<{ principles: ProfileItem[]; hasApprovedVersion: boolean }>;
  existingDecision: Loadable<ExistingDecision | null>;
  /** The Portfolio Fit computed in this visit, and the size it was computed with. Never stored. */
  fit: { data: PortfolioFit; sizeDollars: number | undefined } | undefined;
}

export interface CaseViewActions {
  fetchMarket: CaseAction;
  computeFit: CaseAction<[sizeDollars: number | undefined]>;
  personalFit: CaseAction;
  reading: CaseAction<[sizeDollars: number | undefined]>;
  record: CaseAction<[input: RecordInput]>;
}
