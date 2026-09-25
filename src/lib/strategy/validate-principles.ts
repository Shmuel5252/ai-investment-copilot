import type { EvidenceStrength } from "@/lib/dna/evidence-strength";
import {
  assessCitations,
  type EvidenceIndependenceResolver,
  type IndependenceBasis,
} from "@/lib/evidence/resolve-independence";
import type { ProposedDeclaredPrinciple, ProposedObservedPrinciple } from "@/lib/ai/strategy";
import { parseStatementId, type DecisionStatementRef } from "@/lib/evidence/statement-ref";

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
  /** The cited InterviewAnswer, or null for a decision-time statement (Evidence Reach V1 / OD-4). */
  interviewAnswerId: string | null;
  decisionStatement?: DecisionStatementRef | null;
  stance: "supporting" | "contradicting";
  description: string;
}

export interface ValidatedObservedPrinciple {
  statement: string;
  evidence: ValidatedPrincipleEvidence[];
  supportingCount: number;
  contradictingCount: number;
  evidenceStrength: EvidenceStrength;
  /** Why the counts are what they are (Decision Independence V1); persisted as independence_basis_json. */
  independenceBasis: IndependenceBasis;
}

// `independence` is the SAME shared resolver src/lib/dna/validate-hypotheses.ts
// counts through — never a Strategy-specific algorithm. All validated
// citations still stay in the returned `evidence` array for traceability;
// only the strength-driving counts are collapsed.
export function validateProposedObservedPrinciples(
  proposed: ProposedObservedPrinciple[],
  independence: EvidenceIndependenceResolver
): ValidatedObservedPrinciple[] {
  const results: ValidatedObservedPrinciple[] = [];

  for (const p of proposed) {
    if (!p || typeof p.statement !== "string" || p.statement.trim() === "") continue;
    if (!Array.isArray(p.evidence)) continue;

    const validEvidence: ValidatedPrincipleEvidence[] = [];
    for (const e of p.evidence) {
      if (!e || (e.stance !== "supporting" && e.stance !== "contradicting")) continue;
      if (typeof e.description !== "string" || e.description.trim() === "") continue;
      const source = parseStatementId(e.statementId);
      if (source === null || !independence.hasStatement(source)) continue;
      validEvidence.push({ interviewAnswerId: source.interviewAnswerId, decisionStatement: source.decisionStatement ?? null, stance: e.stance, description: e.description });
    }

    if (validEvidence.length === 0) continue;

    results.push({
      statement: p.statement.trim(),
      evidence: validEvidence,
      ...assessCitations(independence, validEvidence),
    });
  }

  return results;
}
