import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

// The shapes Home reads, taken from the existing procedures. Narrow Picks
// where the procedure returns a whole table row, so the synthetic preview in
// /styleguide can build the same props without inventing columns.
type Out = inferRouterOutputs<AppRouter>;

export type AttentionData = Out["decisions"]["attention"];
export type MonitoringItem = AttentionData["items"][number];
export type ExecutionFact = MonitoringItem["newExecutionAfterDecision"][number];
export type NextActionRow = Out["evidence"]["nextActions"][number];
export type OpenCondition = Out["predictions"]["openReentryConditions"][number];
export type ReachData = Pick<Out["evidence"]["reach"], "summary">;
export type CaseRow = Pick<Out["cases"]["list"][number], "id" | "ticker" | "status" | "createdAt">;
export type IdeaRow = Pick<Out["ideas"]["list"][number], "id" | "ticker" | "promotedToCaseId" | "createdAt">;
export type HistoryData = Pick<Out["import"]["history"], "latestTransactionDate" | "ageDays">;
export type CoverageData = Out["interview"]["journalCoverage"];

// The part of a React Query result a region needs. tRPC's useQuery result
// satisfies it as is; the styleguide preview builds it by hand.
export interface Loadable<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error?: { message: string } | null;
  refetch?: () => unknown;
}

export const loaded = <T,>(data: T): Loadable<T> => ({ data, isLoading: false, isError: false });

// tRPC sends dates as ISO strings without a transformer; every date is read
// through this, on the investor's own calendar.
export const day = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");
