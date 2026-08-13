import { calculateEvidenceStrength, type EvidenceStrength } from "./evidence-strength";
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
export function validateProposedHypotheses(
  proposed: ProposedHypothesis[],
  validAnswerIds: ReadonlySet<string>
): ValidatedHypothesis[] {
  const results: ValidatedHypothesis[] = [];

  for (const h of proposed) {
    if (!h || typeof h.statement !== "string" || h.statement.trim() === "") continue;
    if (!Array.isArray(h.evidence)) continue;

    const validEvidence: ValidatedEvidence[] = h.evidence.filter(
      (e): e is ValidatedEvidence =>
        !!e &&
        typeof e.interviewAnswerId === "string" &&
        validAnswerIds.has(e.interviewAnswerId) &&
        (e.stance === "supporting" || e.stance === "contradicting") &&
        typeof e.description === "string" &&
        e.description.trim() !== ""
    );

    if (validEvidence.length === 0) continue;

    const supportingCount = validEvidence.filter((e) => e.stance === "supporting").length;
    const contradictingCount = validEvidence.filter((e) => e.stance === "contradicting").length;

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
