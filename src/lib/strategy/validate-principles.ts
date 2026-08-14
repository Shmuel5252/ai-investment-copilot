import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import type { ProposedDeclaredPrinciple, ProposedObservedPrinciple } from "@/lib/ai/strategy";

// The AI's citations are never trusted blindly here either (same trust
// boundary as src/lib/dna/validate-hypotheses.ts) — every citedAnswerId
// is checked against real InterviewAnswer ids belonging to this investor
// before a "Declared" principle is even shown to the user for approval.
// A declared principle with zero real citations isn't a thin declared
// principle, it's not a declared principle at all.
export interface ValidatedDeclaredPrinciple {
  statementText: string;
  rationaleText: string;
  citedAnswerIds: string[];
}

export function validateProposedDeclaredPrinciples(
  proposed: ProposedDeclaredPrinciple[],
  validAnswerIds: ReadonlySet<string>
): ValidatedDeclaredPrinciple[] {
  const results: ValidatedDeclaredPrinciple[] = [];

  for (const p of proposed) {
    if (!p || typeof p.statementText !== "string" || p.statementText.trim() === "") continue;
    if (typeof p.rationaleText !== "string") continue;
    if (!Array.isArray(p.citedAnswerIds)) continue;

    const citedAnswerIds = p.citedAnswerIds.filter(
      (id): id is string => typeof id === "string" && validAnswerIds.has(id)
    );
    if (citedAnswerIds.length === 0) continue;

    results.push({
      statementText: p.statementText.trim(),
      rationaleText: p.rationaleText.trim(),
      citedAnswerIds,
    });
  }

  return results;
}

// Mirrors src/lib/dna/validate-hypotheses.ts exactly — "same Evidence
// engine as DNA" (docs/architecture.md §2.4) means the same validation
// trust boundary too, not just the same threshold table.
export interface ValidatedPrincipleEvidence {
  interviewAnswerId: string;
  stance: "supporting" | "contradicting";
  description: string;
}

export interface ValidatedObservedPrinciple {
  statement: string;
  evidence: ValidatedPrincipleEvidence[];
  supportingCount: number;
  contradictingCount: number;
  evidenceStrength: EvidenceStrength;
}

export function validateProposedObservedPrinciples(
  proposed: ProposedObservedPrinciple[],
  validAnswerIds: ReadonlySet<string>
): ValidatedObservedPrinciple[] {
  const results: ValidatedObservedPrinciple[] = [];

  for (const p of proposed) {
    if (!p || typeof p.statement !== "string" || p.statement.trim() === "") continue;
    if (!Array.isArray(p.evidence)) continue;

    const validEvidence: ValidatedPrincipleEvidence[] = p.evidence.filter(
      (e): e is ValidatedPrincipleEvidence =>
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
      statement: p.statement.trim(),
      evidence: validEvidence,
      supportingCount,
      contradictingCount,
      evidenceStrength: calculateEvidenceStrength(supportingCount, contradictingCount),
    });
  }

  return results;
}
