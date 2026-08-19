import { calculateEvidenceStrength, type EvidenceStrength } from "./evidence-strength";
import { countIndependentCases } from "@/lib/evidence/count-independent-cases";
import type { ProposedHypothesis } from "@/lib/ai/dna";

export interface ValidatedEvidence {
  interviewAnswerId: string;
  stance: "supporting" | "contradicting";
  description: string;
}

export interface ValidatedHypothesis {
  statement: string;
  evidence: ValidatedEvidence[];
  supportingCount: number;
  contradictingCount: number;
  evidenceStrength: EvidenceStrength;
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
// `answerCaseKeys` maps each valid interview-answer id to the
// *underlying* case it's really evidence about — its transaction id if
// it has one, else the answer's own id. Two different InterviewAnswers
// about the same transaction (real, reachable: an interview can be
// re-run in a later session and re-select a transaction already asked
// about before — select-transactions.ts only dedupes within one
// session's own selection, not across sessions) must count as one piece
// of evidence, not two — a real gap found by the user on real data. All
// validated citations are still kept in the returned `evidence` array
// for traceability/"View Evidence"; only the counts feeding
// evidenceStrength are deduped by underlying case
// (src/lib/evidence/count-independent-cases.ts).
export function validateProposedHypotheses(
  proposed: ProposedHypothesis[],
  answerCaseKeys: ReadonlyMap<string, string>
): ValidatedHypothesis[] {
  const results: ValidatedHypothesis[] = [];

  for (const h of proposed) {
    if (!h || typeof h.statement !== "string" || h.statement.trim() === "") continue;
    if (!Array.isArray(h.evidence)) continue;

    const validEvidence: ValidatedEvidence[] = h.evidence.filter(
      (e): e is ValidatedEvidence =>
        !!e &&
        typeof e.interviewAnswerId === "string" &&
        answerCaseKeys.has(e.interviewAnswerId) &&
        (e.stance === "supporting" || e.stance === "contradicting") &&
        typeof e.description === "string" &&
        e.description.trim() !== ""
    );

    if (validEvidence.length === 0) continue;

    const { supportingCount, contradictingCount } = countIndependentCases(
      validEvidence,
      (e) => answerCaseKeys.get(e.interviewAnswerId)!
    );

    results.push({
      statement: h.statement.trim(),
      evidence: validEvidence,
      supportingCount,
      contradictingCount,
      evidenceStrength: calculateEvidenceStrength(supportingCount, contradictingCount),
    });
  }

  return results;
}
