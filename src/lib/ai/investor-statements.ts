import type { DecisionStatement } from "@/lib/evidence/decision-statements";

// Evidence Reach V1 (OD-1) — the ONE representation of "what the investor
// themselves wrote" that DNA and observed-Strategy generation hand to the
// model, and the shared rules both prompts state about it. SDK-free: the
// routers build this from persisted rows; the AI modules only format it.
//
// Two sources, always labelled, never mixed:
//   interview_answer   — an onboarding / "Tell me why" answer about a trade;
//   decision_statement — reasoning / risks / exit conditions the investor
//                        wrote when recording a decision (frozen snapshot).
// Nothing AI-written, nothing post-decision (Later Context, Review, outcome,
// execution result) has a Statement ID, so it cannot be cited at all.
export interface InvestorStatementForAnalysis {
  /** The Statement ID the AI must cite back: an answer uuid, or "decision:<id>:<kind>". */
  id: string;
  source: "interview_answer" | "decision_statement";
  /** Interview: the question asked. Decision: which text + which decision. */
  heading: string;
  /** Verbatim. */
  text: string;
}

const KIND_LABEL: Record<DecisionStatement["kind"], string> = {
  reasoning: "reasoning",
  risks: "risks considered",
  exit_conditions: "exit conditions",
};

export function buildInvestorStatements(
  answers: readonly { id: string; questionText: string; answerText: string }[],
  decisionStatements: readonly DecisionStatement[]
): InvestorStatementForAnalysis[] {
  return [
    ...answers.map((a) => ({
      id: a.id,
      source: "interview_answer" as const,
      heading: `Question: ${a.questionText}`,
      text: a.answerText,
    })),
    ...decisionStatements.map((s) => ({
      id: s.statementId,
      source: "decision_statement" as const,
      heading: `${KIND_LABEL[s.kind]} the investor wrote when recording ${s.decisionType} ${s.ticker} on ${s.decisionDate.toISOString().slice(0, 10)}`,
      text: s.text,
    })),
  ];
}

export function formatInvestorStatements(statements: readonly InvestorStatementForAnalysis[]): string {
  return statements
    .map((s) =>
      s.source === "interview_answer"
        ? `Statement ID: ${s.id}\nSource: [interview answer]\n${s.heading}\nText: ${s.text}`
        : `Statement ID: ${s.id}\nSource: [decision statement — ${s.heading}]\nText: ${s.text}`
    )
    .join("\n\n");
}

/** The ground rules both proposal prompts state about statements — one text, two prompts. */
export const INVESTOR_STATEMENT_RULES = `What you are given are STATEMENTS THE INVESTOR WROTE THEMSELVES, each with a Statement ID and a source label:
- [interview answer]: what they said about a trade when interviewed.
- [decision statement — reasoning / risks considered / exit conditions]: what they wrote at the moment they recorded a decision.
Cite evidence ONLY by the exact Statement ID shown. Never invent an ID. There is no ID for any AI-written text or for anything written after a decision (Later Context, reviews, outcomes) — such text is never given to you and is never evidence.
A decision statement is contemporaneous PROCESS evidence: it shows what the investor believed, considered or planned at the time. It is never evidence that the decision was right, worked out, or was executed — do not infer outcomes from it.
Several statements about one decision (its reasoning, risks and exit conditions) — or several answers about one trade — are ONE case, not independent confirmations; repeated wording across them is not more evidence. The system counts independent cases itself; you only cite honestly.`;
