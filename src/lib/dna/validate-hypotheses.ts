import type { EvidenceStrength } from "./evidence-strength";
import {
  assessCitations,
  type EvidenceIndependenceResolver,
  type IndependenceBasis,
} from "@/lib/evidence/resolve-independence";
import type { ProposedHypothesis } from "@/lib/ai/dna";
import { parseStatementId, type DecisionStatementRef } from "@/lib/evidence/statement-ref";

export interface ValidatedEvidence {
  /** The cited InterviewAnswer, or null for a decision-time statement (Evidence Reach V1). */
  interviewAnswerId: string | null;
  decisionStatement?: DecisionStatementRef | null;
  stance: "supporting" | "contradicting";
  description: string;
}

export interface ValidatedHypothesis {
  statement: string;
  evidence: ValidatedEvidence[];
  supportingCount: number;
  contradictingCount: number;
  evidenceStrength: EvidenceStrength;
  /** Why the counts are what they are (Decision Independence V1); persisted as independence_basis_json. */
  independenceBasis: IndependenceBasis;
}

// The AI's citations are never trusted blindly (docs principle: AI
// doesn't invent facts, judgment requires Evidence). This drops any
// citation that doesn't resolve to a real InterviewAnswer id belonging
// to this investor, then drops any hypothesis left with zero evidence —
// a hypothesis whose only "evidence" was hallucinated is not a weak
// hypothesis, it's not a hypothesis at all. evidenceStrength is always
// computed here in code from the *validated* counts, never taken from
// the AI's output.
//
// `independence` is the ONE shared resolver DNA and Strategy both count
// through (src/lib/evidence/resolve-independence.ts). Two different
// InterviewAnswers about the same transaction (real, reachable: an
// interview can be re-run in a later session and re-select a transaction
// already asked about before) or about one position episode must count as
// one piece of evidence, not two; a cross-ticker reallocation the investor
// described from both ends is a weak dependence edge that lowers the
// supporting count. All validated citations are still kept in the returned
// `evidence` array for traceability/"View Evidence" — only the counts
// feeding evidenceStrength are collapsed.
export function validateProposedHypotheses(
  proposed: ProposedHypothesis[],
  independence: EvidenceIndependenceResolver
): ValidatedHypothesis[] {
  const results: ValidatedHypothesis[] = [];

  for (const h of proposed) {
    if (!h || typeof h.statement !== "string" || h.statement.trim() === "") continue;
    if (!Array.isArray(h.evidence)) continue;

    // The AI cites a Statement ID: an answer uuid, or "decision:<id>:<kind>".
    // Anything else — including any id form for AI-generated or post-decision
    // text, which does not exist — is dropped here; an unknown but well-formed
    // id is dropped by hasStatement (never a persisted statement of this investor).
    const validEvidence: ValidatedEvidence[] = [];
    for (const e of h.evidence) {
      if (!e || (e.stance !== "supporting" && e.stance !== "contradicting")) continue;
      if (typeof e.description !== "string" || e.description.trim() === "") continue;
      const source = parseStatementId(e.statementId);
      if (source === null || !independence.hasStatement(source)) continue;
      validEvidence.push({ interviewAnswerId: source.interviewAnswerId, decisionStatement: source.decisionStatement ?? null, stance: e.stance, description: e.description });
    }

    if (validEvidence.length === 0) continue;

    results.push({
      statement: h.statement.trim(),
      evidence: validEvidence,
      ...assessCitations(independence, validEvidence),
    });
  }

  return results;
}
