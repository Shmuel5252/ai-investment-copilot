import { assessCitations, type EvidenceIndependenceResolver } from "@/lib/evidence/resolve-independence";
import type { ValidatedEvidence, ValidatedHypothesis } from "./validate-hypotheses";
import type { EvidenceGroundingCheckInput, EvidenceGroundingResult } from "@/lib/ai/dna-grounding";
import { statementIdOf } from "@/lib/evidence/statement-ref";

// Evidence Grounding — the second, separate validation gate that runs
// AFTER validateProposedHypotheses()'s existing structural checks
// (citation id is real, stance is a real enum value, description
// non-empty) and BEFORE anything is persisted. Structural validity was
// never the gap here: the AI's evidence description can cite a real
// answer, with a real stance, non-empty text, and still selectively
// reframe what that answer actually says (the real CAN case: a missed
// Nasdaq compliance deadline and a declining stock, cited as "sold a
// profitable position for a better opportunity, thesis intact"). This
// module never re-derives that judgment itself — it's a thin,
// deterministic orchestrator around an injected grounding-check function
// (dependency-injected so it's testable with a fixed fixture instead of a
// real Anthropic call — see tests/unit/ground-evidence.test.ts).
//
// The grounding check is keyed on (hypothesis statement, stance, REAL
// answer text) — never on the AI's own description, which is passed to
// nothing here at all. It's per (hypothesis, citation) pair, not per
// answer alone: the exact same real answer can genuinely support one
// hypothesis's claim and not another's (CAN's own text supports "sold
// when momentum weakened / an external target was missed", not "sold a
// winner for a better opportunity, thesis intact").
export type GroundingCheckFn = (input: EvidenceGroundingCheckInput) => Promise<EvidenceGroundingResult>;

export interface GroundedEvidence extends ValidatedEvidence {
  groundingReason: string;
}

export interface GroundingRunResult {
  hypotheses: ValidatedHypothesis[];
  /** Every citation excluded by grounding, across every hypothesis — for logging/reporting, never for display as if it were still evidence. */
  excluded: { statement: string; statementId: string; stance: "supporting" | "contradicting"; reason: string }[];
  /** Hypotheses dropped entirely because zero citations survived grounding. */
  droppedHypotheses: string[];
}

// Runs every (hypothesis, citation) pair through the grounding check,
// keeps only citations that come back `supported`, then recomputes
// supportingCount/contradictingCount/evidenceStrength from the SURVIVING
// citations only, via the exact same shared independence resolver
// (assessCitations) every other path uses — Evidence Strength
// stays fully deterministic once the accepted-citation set is settled;
// the AI's role here is strictly a binary include/exclude gate per
// citation, never a number, never a confidence score fed into strength.
// A hypothesis left with zero surviving citations is dropped entirely —
// the same "no real evidence, not a thin hypothesis, not a hypothesis at
// all" rule validateProposedHypotheses() already applies to hallucinated
// citation ids.
export async function groundValidatedHypotheses(
  hypotheses: readonly ValidatedHypothesis[],
  answerTextById: ReadonlyMap<string, string>,
  independence: EvidenceIndependenceResolver,
  checkGrounding: GroundingCheckFn
): Promise<GroundingRunResult> {
  const result: ValidatedHypothesis[] = [];
  const excluded: GroundingRunResult["excluded"] = [];
  const droppedHypotheses: string[] = [];

  for (const hypothesis of hypotheses) {
    const groundedEvidence: ValidatedEvidence[] = [];

    for (const evidence of hypothesis.evidence) {
      const statementId = statementIdOf(evidence) ?? "";
      const sourceAnswerText = answerTextById.get(statementId);
      // Shouldn't happen — validateProposedHypotheses already confirmed
      // this id is real — but if the text is somehow unavailable, that's
      // exactly the kind of missing/malformed input this gate must fail
      // closed on, not silently pass through.
      if (sourceAnswerText === undefined) {
        excluded.push({
          statement: hypothesis.statement,
          statementId,
          stance: evidence.stance,
          reason: "Source statement text unavailable — failing closed.",
        });
        continue;
      }

      // Defense in depth: the real checkEvidenceGrounding() already never
      // throws (it has its own internal fail-closed try/catch), but this
      // orchestrator takes the check as an injected dependency — if a
      // caller ever wires in an implementation that violates that
      // contract and throws, a single bad citation must still fail
      // closed (excluded), not crash the whole hypothesis or the whole
      // batch.
      let verdict: EvidenceGroundingResult;
      try {
        verdict = await checkGrounding({
          hypothesisStatement: hypothesis.statement,
          stance: evidence.stance,
          sourceAnswerText,
          sourceKind: evidence.decisionStatement ? "decision_statement" : "interview_answer",
        });
      } catch {
        verdict = { verdict: "unsupported", reason: "Grounding check threw — failing closed." };
      }

      if (verdict.verdict === "supported") {
        groundedEvidence.push(evidence);
      } else {
        excluded.push({
          statement: hypothesis.statement,
          statementId,
          stance: evidence.stance,
          reason: verdict.reason,
        });
      }
    }

    if (groundedEvidence.length === 0) {
      droppedHypotheses.push(hypothesis.statement);
      continue;
    }

    result.push({
      statement: hypothesis.statement,
      evidence: groundedEvidence,
      ...assessCitations(independence, groundedEvidence),
    });
  }

  return { hypotheses: result, excluded, droppedHypotheses };
}
