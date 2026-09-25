// Evidence Reach V1 — the versioned evidence-source contract (Owner
// decisions OD-1 / OD-4, docs/data-model.md §2 "Evidence sources").
//
// An investor STATEMENT is the unit of citable evidence. There are exactly
// two kinds of investor-authored statement a DNA hypothesis or an observed
// Strategy principle may cite:
//   - INTERVIEW_ANSWER          — an InterviewAnswer (id = its uuid, unchanged);
//   - DECISION_* (three kinds)  — what the investor wrote when RECORDING a
//     decision: user_reasoning_text, risks_considered_text,
//     exit_conditions_text (frozen in the DecisionSnapshot, immutable).
// A decision statement is contemporaneous decision-process evidence: what
// the investor believed / considered / planned at the time. It is never
// evidence that the belief was correct.
//
// Everything AI-generated (thesis interpretation, real-time assessment,
// predictions, case synthesis, Personal Fit, Review text, evidence
// descriptions, Learning statements) and every post-decision text (Later
// Context, Outcome, execution results) is NOT a statement here and cannot be
// cited — there is no id form for them, so a citation cannot even name one.
//
// Statement ids are the strings the AI sees and cites:
//   interview answer  -> the answer uuid itself (the pre-existing contract);
//   decision statement -> "decision:<decisionId>:<kind>".
// A citation is keyed by statementKeyOf() everywhere counting, deduping and
// rejection-tracking happens, so an answer and a decision statement can never
// collide and the same statement is never counted twice.
export const EVIDENCE_SOURCE_CONTRACT_VERSION = "evidence-source-v1" as const;

export const DECISION_STATEMENT_KINDS = ["reasoning", "risks", "exit_conditions"] as const;
export type DecisionStatementKind = (typeof DECISION_STATEMENT_KINDS)[number];

export interface DecisionStatementRef {
  decisionId: string;
  kind: DecisionStatementKind;
}

/** The minimal shape every citation / evidence row shares once decision statements exist. */
export interface StatementSource {
  interviewAnswerId: string | null;
  decisionStatement?: DecisionStatementRef | null;
}

export function formatDecisionStatementId(ref: DecisionStatementRef): string {
  return `decision:${ref.decisionId}:${ref.kind}`;
}

/** The AI-facing id of a citation / evidence row (an answer uuid, or a decision statement id). */
export function statementIdOf(source: StatementSource): string | null {
  if (source.decisionStatement) return formatDecisionStatementId(source.decisionStatement);
  return source.interviewAnswerId;
}

/** The counting/dedupe key: namespaced so the two source kinds can never collide. */
export function statementKeyOf(source: StatementSource): string {
  if (source.decisionStatement) return formatDecisionStatementId(source.decisionStatement);
  return source.interviewAnswerId === null ? "unsourced" : `answer:${source.interviewAnswerId}`;
}

const KIND_SET: ReadonlySet<string> = new Set(DECISION_STATEMENT_KINDS);

/**
 * Parses an id the AI cited into one of the two source shapes. Ids are
 * opaque: "decision:<id>:<kind>" is a decision statement, any other
 * colon-free string is an interview-answer id. Whether the id names a
 * PERSISTED statement of this investor is decided by the resolver
 * (hasStatement), never here. There is deliberately no id form for
 * AI-generated or post-decision text — nothing else parses.
 */
export function parseStatementId(id: unknown): StatementSource | null {
  if (typeof id !== "string" || id === "") return null;
  if (id.startsWith("decision:")) {
    const parts = id.split(":");
    if (parts.length !== 3 || parts[1] === "" || !KIND_SET.has(parts[2]!)) return null;
    return { interviewAnswerId: null, decisionStatement: { decisionId: parts[1]!, kind: parts[2] as DecisionStatementKind } };
  }
  if (id.includes(":")) return null;
  return { interviewAnswerId: id, decisionStatement: null };
}

/** The evidence table's source columns for a statement citation — the ONE mapper every insert path uses. */
export function evidenceSourceColumnsOf(source: StatementSource): {
  interviewAnswerId: string | null;
  decisionId: string | null;
  decisionStatementKind: DecisionStatementKind | null;
} {
  const d = source.decisionStatement ?? null;
  return d
    ? { interviewAnswerId: null, decisionId: d.decisionId, decisionStatementKind: d.kind }
    : { interviewAnswerId: source.interviewAnswerId, decisionId: null, decisionStatementKind: null };
}

export function sameStatement(a: StatementSource, b: StatementSource): boolean {
  return statementKeyOf(a) === statementKeyOf(b);
}
