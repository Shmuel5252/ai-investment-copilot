import type { EvidenceCitation } from "@/lib/evidence/resolve-independence";
import type { DecisionStatement } from "@/lib/evidence/decision-statements";
import type { EvidenceGroundingCheckInput, EvidenceGroundingResult } from "@/lib/ai/dna-grounding";

// Evidence Reach V1 — OD-3, the carry from an AGREED Learning insight into a
// new DNA hypothesis. Three deterministic steps and one grounding gate:
//
//   1. citedReviewsOfVersion — WHICH reviews the agreed version cited, with
//      the stance that version gave each: the version's own provenance
//      (`citedReviews`, written by learning.generate) is the authority;
//      legacy versions (NULL provenance) fall back to the identity's evidence
//      rows. Stances are never re-derived and never invented from agreement.
//   2. buildLearningCarryCases — reviews -> the underlying DECISIONS of this
//      investor: several reviews of one decision = one case; a review that
//      does not map (another investor's) is dropped; both stances are kept
//      when reviews disagree (the resolver then makes that one case
//      contradicting — never +1 supporting).
//   3. groundCarryCitations — the SAME grounding gate every persisted DNA
//      citation passes (checkEvidenceGrounding, fail-closed): each of the
//      decision's own investor-authored statements (reasoning / risks / exit
//      conditions) is checked against the NEW hypothesis wording with the
//      insight's stance. Only `supported` statements become evidence rows. A
//      review having cited a decision is NOT textual grounding of the new
//      claim; a decision whose statements do not ground it carries nothing.
//      The agreement, the insight and the reviews are never evidence.
// Counts/tier come from assessCitations over the grounded citations (OD-2).
export interface CitedReview {
  decisionReviewId: string;
  stance: "supporting" | "contradicting";
}

export function citedReviewsOfVersion(
  version: { provenanceJson: unknown },
  identityEvidence: readonly { decisionReviewId: string | null; stance: "supporting" | "contradicting" }[]
): CitedReview[] {
  const fromProvenance = (version.provenanceJson as { citedReviews?: unknown } | null)?.citedReviews;
  if (Array.isArray(fromProvenance)) {
    const valid = fromProvenance.filter(
      (c): c is CitedReview =>
        !!c && typeof (c as CitedReview).decisionReviewId === "string" && ((c as CitedReview).stance === "supporting" || (c as CitedReview).stance === "contradicting")
    );
    if (valid.length > 0) return valid;
  }
  return identityEvidence.filter((e): e is { decisionReviewId: string; stance: "supporting" | "contradicting" } => e.decisionReviewId !== null);
}

export interface CarryCase {
  decisionId: string;
  stance: "supporting" | "contradicting";
}

export function buildLearningCarryCases(cited: readonly CitedReview[], reviewDecisionIds: ReadonlyMap<string, string>): CarryCase[] {
  const seen = new Set<string>();
  const out: CarryCase[] = [];
  for (const c of cited) {
    const decisionId = reviewDecisionIds.get(c.decisionReviewId);
    if (decisionId === undefined) continue;
    const key = `${decisionId}::${c.stance}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ decisionId, stance: c.stance });
  }
  return out.sort((a, b) => a.decisionId.localeCompare(b.decisionId) || a.stance.localeCompare(b.stance));
}

export interface CarriedCitation extends EvidenceCitation {
  interviewAnswerId: null;
  decisionStatement: { decisionId: string; kind: DecisionStatement["kind"] };
  groundingReason: string;
}

export interface CarryGroundingResult {
  citations: CarriedCitation[];
  /** Every (decision, statement, stance) the gate excluded — reporting only, never evidence. */
  excluded: { decisionId: string; kind: DecisionStatement["kind"]; stance: "supporting" | "contradicting"; reason: string }[];
  /** Cited decisions with no statement at all (nothing to ground against). */
  decisionsWithoutStatements: string[];
}

export type CarryGroundingCheckFn = (input: EvidenceGroundingCheckInput) => Promise<EvidenceGroundingResult>;

export async function groundCarryCitations(
  hypothesisStatement: string,
  cases: readonly CarryCase[],
  statements: readonly DecisionStatement[],
  checkGrounding: CarryGroundingCheckFn
): Promise<CarryGroundingResult> {
  const byDecision = new Map<string, DecisionStatement[]>();
  for (const s of statements) byDecision.set(s.decisionId, [...(byDecision.get(s.decisionId) ?? []), s]);

  const citations: CarriedCitation[] = [];
  const excluded: CarryGroundingResult["excluded"] = [];
  const decisionsWithoutStatements: string[] = [];
  for (const c of cases) {
    const own = byDecision.get(c.decisionId) ?? [];
    if (own.length === 0) {
      if (!decisionsWithoutStatements.includes(c.decisionId)) decisionsWithoutStatements.push(c.decisionId);
      continue;
    }
    for (const s of own) {
      let verdict: EvidenceGroundingResult;
      try {
        verdict = await checkGrounding({ hypothesisStatement, stance: c.stance, sourceAnswerText: s.text, sourceKind: "decision_statement" });
      } catch {
        verdict = { verdict: "unsupported", reason: "Grounding check threw — failing closed." };
      }
      if (verdict.verdict === "supported") {
        citations.push({ interviewAnswerId: null, decisionStatement: { decisionId: c.decisionId, kind: s.kind }, stance: c.stance, groundingReason: verdict.reason });
      } else {
        excluded.push({ decisionId: c.decisionId, kind: s.kind, stance: c.stance, reason: verdict.reason });
      }
    }
  }
  return { citations, excluded, decisionsWithoutStatements };
}
