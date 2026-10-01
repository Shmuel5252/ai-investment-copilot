import type { DecisionStatement } from "@/lib/evidence/decision-statements";
import { formatDay, isAnchorContextV1 } from "@/lib/interview/anchor-context";

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

// Guided Interview PIT contract (Unit 7C-B) — the ONE policy for what an AI
// consumer may see of the question an interview answer responded to. Every
// consumer goes through aiQuestionContext(): the DNA and observed-Strategy
// statement headings, the declared-Strategy answers, the grounding gate's
// CONTEXT and the Prior Record brief. The investor's answer is never touched
// by it; it is always passed verbatim and labelled as theirs elsewhere.
//   guided_legacy      — the stored AI wording predates the point-in-time
//                        rule and may carry hindsight (a return, a holding
//                        period, a ranking). It is withheld; a neutral
//                        referent built from the anchored transaction's own
//                        stored side, ticker and date takes its place.
//   tell_me_why_legacy — code-built, no outcome facts by construction: kept.
//   PIT values         — the code-built facts line of the immutable snapshot,
//                        then the validated or deterministic question.
//   anything else      — unknown provenance or an unreadable snapshot fails
//                        closed, exactly like guided_legacy.
export type QuestionProvenance = "guided_legacy" | "tell_me_why_legacy" | "guided_pit_ai" | "guided_pit_fallback" | "tell_me_why_pit";

export interface AnswerQuestionSource {
  questionText: string;
  questionProvenance?: string | null;
  anchorContext?: unknown;
  anchorTicker?: string | null;
  anchorSide?: string | null;
  anchorDate?: Date | string | null;
}

const PIT_PROVENANCE = new Set(["guided_pit_ai", "guided_pit_fallback", "tell_me_why_pit"]);
export const LEGACY_QUESTION_WITHHELD = "שאלת AI ישנה הוסרה מההקשר: היא נכתבה לפני כלל הזמן-אמת ועלולה לכלול מידע מאוחר.";

function legacyReferent(a: AnswerQuestionSource): string {
  if (!a.anchorTicker || !a.anchorDate || (a.anchorSide !== "buy" && a.anchorSide !== "sell")) return LEGACY_QUESTION_WITHHELD;
  const iso = (a.anchorDate instanceof Date ? a.anchorDate : new Date(a.anchorDate)).toISOString().slice(0, 10);
  return `${LEGACY_QUESTION_WITHHELD} התשובה עוסקת ב${a.anchorSide === "sell" ? "מכירה" : "קנייה"} של ${a.anchorTicker} ב-${formatDay(iso)}.`;
}

export function aiQuestionContext(a: AnswerQuestionSource): string {
  if (a.questionProvenance === "tell_me_why_legacy") return a.questionText;
  if (a.questionProvenance && PIT_PROVENANCE.has(a.questionProvenance) && isAnchorContextV1(a.anchorContext)) {
    return `${a.anchorContext.factsLine}\n${a.questionText}`;
  }
  return legacyReferent(a);
}

export function buildInvestorStatements(
  answers: readonly ({ id: string; answerText: string } & AnswerQuestionSource)[],
  decisionStatements: readonly DecisionStatement[]
): InvestorStatementForAnalysis[] {
  return [
    ...answers.map((a) => ({
      id: a.id,
      source: "interview_answer" as const,
      heading: `Question: ${aiQuestionContext(a)}`,
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

// Grounding Semantics V3.2 (OD-V32-7) — Statement ID -> the interview
// question the answer responded to, for the grounding gate's CONTEXT section
// only. Read from the persisted answer row through aiQuestionContext() (Unit
// 7C-B), never reconstructed from current history. Interview answers only: a decision statement has no
// question and therefore no entry. The question is not a statement, has no
// Statement ID of its own, and is never evidence.
export function buildStatementContextById(
  answers: readonly ({ id: string } & AnswerQuestionSource)[]
): Map<string, string> {
  return new Map(answers.map((a) => [a.id, aiQuestionContext(a)] as const).filter(([, context]) => context.trim() !== ""));
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
