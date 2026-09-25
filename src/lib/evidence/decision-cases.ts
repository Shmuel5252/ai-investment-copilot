// Evidence Reach V1 — OD-2: the independent-case key of a Decision, pure
// (no DB, no AI, no clock, no time zone).
//
// A decision-time statement never becomes an extra independent case when it
// belongs to the same investment episode as a trade the investor was
// interviewed about. The ONLY bridge is an effective, investor-confirmed
// `executed` execution fact (Decision Follow-Through V1):
//   A. executed fact(s)  -> the decision merges with those transactions'
//      episodes: ONE case with them (all its statements share it);
//   B. never merged by ticker, date, amount, position or inferred intent;
//   C. executable candidates exist but none is classified -> UNRESOLVED:
//      counted as neither supporting nor contradicting (review-only, like
//      bare temporal proximity in Decision Independence V1) — uncertainty
//      never increases confidence; the next action is to classify them;
//   D. PASS/HOLD cannot be executed by a trade -> own case;
//   E. no executable candidate -> own case;
//   F. `unrelated` facts classify a candidate but never merge;
//   G. several executed trades still give ONE decision case (label union).
//
// "Executable candidate" here is a deliberate SUPERSET of the product's
// zone-aware candidate list (src/lib/execution/execution-facts.ts): same
// investor, same ticker, the executable side for the decision type, dated on
// or after the decision's UTC day minus one. The one-day tolerance covers
// every time zone without a client zone, so a trade that is a candidate in
// the investor's own zone is never missed here — the fail-closed direction
// (more decisions unresolved, never fewer).
import { EXECUTED_SIDE } from "@/lib/execution/execution-facts";
import { utcDay } from "@/lib/monitoring/decision-attention";
import { INDEPENDENCE_POLICY } from "./resolve-independence";

export interface DecisionForCases {
  id: string;
  ticker: string;
  decisionType: string;
  decisionDate: Date;
}

export interface TransactionForCases {
  id: string;
  ticker: string | null;
  transactionType: string;
  /** Date-only value (00:00Z) read by its UTC date components. */
  transactionDate: Date;
}

/** One EFFECTIVE (chain-head) execution fact of the decision. */
export interface ExecutionFactForCases {
  /** The fact row id — recorded in the basis so a merged case can be traced back to the investor's assertions. */
  id?: string;
  decisionId: string;
  transactionId: string;
  verdict: "executed" | "unrelated";
}

export type DecisionCaseResolution =
  | { kind: "merged"; transactionIds: string[]; executedFactIds: string[] }
  | { kind: "own" }
  | { kind: "unresolved"; candidateTransactionIds: string[] };

const norm = (t: string | null) => (t ?? "").trim().toUpperCase();
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function executableCandidateIds(decision: DecisionForCases, transactions: readonly TransactionForCases[]): string[] {
  const side = EXECUTED_SIDE[decision.decisionType] ?? null;
  if (side === null) return [];
  const floor = utcDay(decision.decisionDate) - INDEPENDENCE_POLICY.candidateDayTolerance;
  return transactions
    .filter((t) => t.transactionType === side && norm(t.ticker) === norm(decision.ticker) && utcDay(t.transactionDate) >= floor)
    .map((t) => t.id)
    .sort(cmp);
}

export function resolveDecisionCase(
  decision: DecisionForCases,
  transactions: readonly TransactionForCases[],
  effectiveFacts: readonly ExecutionFactForCases[]
): DecisionCaseResolution {
  const own = effectiveFacts.filter((f) => f.decisionId === decision.id);
  const executedFacts = own.filter((f) => f.verdict === "executed");
  const executed = [...new Set(executedFacts.map((f) => f.transactionId))].sort(cmp);
  if (executed.length > 0) {
    return { kind: "merged", transactionIds: executed, executedFactIds: [...new Set(executedFacts.map((f) => f.id).filter((id): id is string => id !== undefined))].sort(cmp) };
  }
  const candidates = executableCandidateIds(decision, transactions);
  if (candidates.length === 0) return { kind: "own" };
  const classified = new Set(own.map((f) => f.transactionId));
  const unclassified = candidates.filter((id) => !classified.has(id));
  if (unclassified.length === 0) return { kind: "own" }; // every candidate explicitly "unrelated"
  return { kind: "unresolved", candidateTransactionIds: unclassified };
}

export function resolveDecisionCases(
  decisions: readonly DecisionForCases[],
  transactions: readonly TransactionForCases[],
  effectiveFacts: readonly ExecutionFactForCases[]
): Map<string, DecisionCaseResolution> {
  return new Map(decisions.map((d) => [d.id, resolveDecisionCase(d, transactions, effectiveFacts)]));
}
