// Evidence Reach V1 (OD-1) — the pure projection of a Decision into its
// citable investor-authored statements: what the investor wrote at decision
// time into the immutable DecisionSnapshot (reasoning, risks considered,
// exit conditions). Nothing else on a decision is a statement: not the AI's
// assessment, not the frozen case synthesis, not Later Context, not the
// Review, not the outcome. Text is projected verbatim, never rewritten.
import { formatDecisionStatementId, DECISION_STATEMENT_KINDS, type DecisionStatementKind } from "./statement-ref";

export interface DecisionRowForStatements {
  id: string;
  ticker: string;
  decisionType: string;
  decisionDate: Date;
  /** When the decision (and its frozen snapshot) entered the system — the statement's own creation instant. */
  createdAt: Date;
  userReasoningText: string | null;
  risksConsideredText: string | null;
  exitConditionsText: string | null;
}

export interface DecisionStatement {
  /** "decision:<decisionId>:<kind>" — what the AI cites back. */
  statementId: string;
  decisionId: string;
  kind: DecisionStatementKind;
  ticker: string;
  decisionType: string;
  decisionDate: Date;
  createdAt: Date;
  /** The investor's own words, verbatim. */
  text: string;
}

const TEXT_OF: Record<DecisionStatementKind, keyof DecisionRowForStatements> = {
  reasoning: "userReasoningText",
  risks: "risksConsideredText",
  exit_conditions: "exitConditionsText",
};

/** One statement per non-empty investor-authored text, in the fixed kind order. */
export function decisionStatementsOf(row: DecisionRowForStatements): DecisionStatement[] {
  const out: DecisionStatement[] = [];
  for (const kind of DECISION_STATEMENT_KINDS) {
    const raw = row[TEXT_OF[kind]];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    out.push({
      statementId: formatDecisionStatementId({ decisionId: row.id, kind }),
      decisionId: row.id,
      kind,
      ticker: row.ticker,
      decisionType: row.decisionType,
      decisionDate: row.decisionDate,
      createdAt: row.createdAt,
      text: raw,
    });
  }
  return out;
}
