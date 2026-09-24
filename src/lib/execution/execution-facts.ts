// Decision Follow-Through V1 — pure rules for execution facts (no DB, no
// AI). The repository (src/db/repositories/execution-facts.ts) feeds these
// with persisted rows and enforces the same rules atomically on insert.
//
// What the system never does here: infer that a trade executed a decision.
// Same ticker, a nearby date or a similar amount only make a trade a
// CANDIDATE; the verdict is the investor's — and even the investor cannot
// assert the impossible (a PASS "executed" by a trade, a decision "executed"
// by a trade dated before it).
import { calendarDay, utcDay } from "@/lib/monitoring/decision-attention";
import { selectEffectiveLinkFacts } from "@/lib/evidence/link-facts";

export type ExecutionVerdict = "executed" | "unrelated";

/** The trade side that can execute each decision type; null = no trade executes it. */
export const EXECUTED_SIDE: Record<string, "buy" | "sell" | null> = {
  BUY: "buy",
  ADD: "buy",
  REDUCE: "sell",
  SELL: "sell",
  PASS: null,
  HOLD: null,
};

export interface ExecutionFactDecision {
  id: string;
  investorId: string;
  ticker: string;
  decisionType: string;
  decisionDate: Date;
}

export interface ExecutionFactTransaction {
  id: string;
  investorId: string;
  ticker: string | null;
  transactionType: string;
  /** Date-only value (00:00Z, read by its UTC date components — see decision-attention.ts). */
  transactionDate: Date;
}

export interface ExecutionFactShapeInput {
  investorId: string;
  verdict: ExecutionVerdict;
  decision: ExecutionFactDecision;
  /** The persisted row for the requested transaction id, or null when not found. */
  transaction: ExecutionFactTransaction | null;
  /** IANA zone the decision instant is placed on the calendar in (the investor's UI zone). */
  timeZone: string;
}

const norm = (t: string | null) => (t ?? "").trim().toUpperCase();

/** The one day rule: the trade's calendar day is on or after the decision's day in the investor's zone. */
const onOrAfterDecisionDay = (decision: { decisionDate: Date }, transaction: { transactionDate: Date }, timeZone: string) =>
  utcDay(transaction.transactionDate) >= calendarDay(decision.decisionDate, timeZone);

/** Pure side/day rule: can a trade of this side, dated on this day, be an execution of the decision? */
export function canExecute(
  decision: { decisionType: string; decisionDate: Date },
  transaction: { transactionType: string; transactionDate: Date },
  timeZone: string
): boolean {
  const side = EXECUTED_SIDE[decision.decisionType] ?? null;
  if (side === null || transaction.transactionType !== side) return false;
  return onOrAfterDecisionDay(decision, transaction, timeZone);
}

// Returns every violated rule (empty = valid).
export function validateExecutionFactShape(input: ExecutionFactShapeInput): string[] {
  const errors: string[] = [];
  const { decision, transaction } = input;
  if (decision.investorId !== input.investorId) errors.push("The decision does not belong to this investor.");
  if (transaction === null) {
    errors.push("Unknown transaction.");
    return errors;
  }
  if (transaction.investorId !== input.investorId) errors.push("The transaction does not belong to this investor.");
  if (transaction.transactionType !== "buy" && transaction.transactionType !== "sell") errors.push("Only a buy or sell trade can be asserted.");
  if (norm(transaction.ticker) !== norm(decision.ticker)) errors.push("The trade is not in the decision's ticker.");
  if (input.verdict === "executed" && errors.length === 0) {
    const side = EXECUTED_SIDE[decision.decisionType] ?? null;
    if (side === null) errors.push(`A ${decision.decisionType} decision is not executed by a trade.`);
    else if (transaction.transactionType !== side) {
      errors.push(`A ${decision.decisionType} decision is executed by a ${side}, not a ${transaction.transactionType}.`);
    } else if (!onOrAfterDecisionDay(decision, transaction, input.timeZone)) {
      errors.push("A trade dated before the decision day cannot have executed it (if the decision was actually made earlier, add Later Context).");
    }
  }
  return errors;
}

export interface ExecutionFactRow {
  id: string;
  decisionId: string;
  transactionId: string;
  verdict: ExecutionVerdict;
  note: string | null;
  supersedesFactId: string | null;
}

// Chain heads: the one effective fact per (decision, transaction) pair.
export function selectEffectiveExecutionFacts<T extends { id: string; supersedesFactId: string | null }>(facts: readonly T[]): T[] {
  return selectEffectiveLinkFacts(facts);
}

/**
 * What an assertion means against the effective facts of the SAME pair
 * (after removing the fact being superseded): nothing yet → insert; an
 * identical assertion → replay (idempotent retry, nothing written); a
 * different one → conflict (it must supersede the existing fact explicitly).
 */
export function classifyAssertion(
  next: { decisionId: string; transactionId: string; verdict: ExecutionVerdict; note: string | null },
  effectiveAfterSupersession: readonly ExecutionFactRow[]
): { kind: "insert" } | { kind: "replay"; fact: ExecutionFactRow } | { kind: "conflict"; fact: ExecutionFactRow } {
  const same = effectiveAfterSupersession.find((f) => f.decisionId === next.decisionId && f.transactionId === next.transactionId);
  if (!same) return { kind: "insert" };
  if (same.verdict === next.verdict && (same.note ?? null) === (next.note ?? null)) return { kind: "replay", fact: same };
  return { kind: "conflict", fact: same };
}
