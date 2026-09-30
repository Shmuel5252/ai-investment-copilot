import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

// Shapes the /import components render, taken from the import router's own
// outputs so they cannot drift from the contract. Dates arrive as ISO
// strings at runtime (no tRPC transformer); every date is read through
// day() or new Date().
type Out = inferRouterOutputs<AppRouter>["import"];
export type HistoryData = Out["history"];
export type PreviewData = Out["preview"];
export type ValidationData = Out["validate"];
export type Reconciliation = ValidationData["reconciliation"];
export type ReconciliationRow = Reconciliation["rows"][number];
export type CollisionGroup = ValidationData["collisionGroups"][number];
export type CorporateAction = Out["corporateActions"][number];
export type ImportResult = Out["confirmImport"];
export type ManualResult = Out["confirmManualEntry"];
type PositionsData = ImportResult["positions"];
/** The part of the returned portfolio state the done screens show. */
export interface PositionsView {
  positions: Pick<PositionsData["positions"][number], "ticker" | "quantity" | "costBasisPerShare" | "costBasisConfidence">[];
  cash: number;
}
export type ImportResultView = Pick<ImportResult, "importedCount" | "skippedExactCount" | "skippedSameCount" | "separateCount"> & { positions: PositionsView };
export interface ManualResultView {
  transactions: Pick<ManualResult["transactions"][number], "id" | "ticker" | "transactionType" | "quantity" | "price" | "transactionDate">[];
  skippedCount: number;
  positions: PositionsView;
}

/** The investor's answer for one flagged row, sent to confirm as-is; the server re-verifies it under its lock. */
export type ResolutionDraft = { action: "same" | "separate"; existingTransactionId?: string };

/**
 * A failed write, classified by what the contract lets us know. Every refusal
 * the import router raises before or inside its database transaction is a
 * BAD_REQUEST (input validation, invalid rows, reconciliation and ordering
 * errors), and a transaction that throws rolls back: nothing was written.
 * Any other failure (a lost response, a server error after the commit, such
 * as an opening-state insert) cannot tell us whether something was saved.
 */
export interface WriteError {
  message: string;
  refused: boolean;
}

export function toWriteError(err: unknown): WriteError | null {
  if (!err) return null;
  const code = (err as { data?: { code?: string } | null }).data?.code;
  return { message: err instanceof Error ? err.message : String(err), refused: code === "BAD_REQUEST" };
}

export interface OpeningStateDraft {
  ticker: string;
  quantity: string;
  costBasisPerShare: string;
  costBasisConfidence: "known" | "approximate" | "unknown";
  asOfDate: string;
}

export interface ManualRowDraft {
  ticker: string;
  transactionType: "buy" | "sell";
  quantity: string;
  price: string;
  transactionDate: string;
  notes: string;
  /** Same-day order, used only when this row is in a group that can take one. Empty = no declaration. */
  intraDayOrder: string;
}

export type SplitSource = "issuer_disclosure" | "broker_statement" | "user_declared";
