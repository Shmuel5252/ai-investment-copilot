import type { EvidenceGroundingCheckInput, EvidenceGroundingResult } from "@/lib/ai/dna-grounding";
import { STANCE_SEMANTICS_VERSION } from "@/lib/ai/stance-rules";

// Test scaffolding only — a deterministic REFERENCE gate that encodes the
// frozen Grounding Semantics V3.2 rule for fixture texts, so tests prove what
// the production pipeline does with each verdict and never what a live model
// says. No model is called.
//
// The rule it encodes (OD-V32-1..5, OD-V32-7):
//   - a claim lists, per stance, the conjunctions of components that are
//     sufficient (AND inside a list, OR between lists);
//   - a citation is `supported` only when EVERY component of at least one
//     list is established — a partial match is `unsupported`;
//   - components are established by the investor's OWN WORDS (`says`);
//   - the interview question (contextText) may add exactly one thing: the
//     action or topic under discussion, and only for an answer that gives a
//     reason for it. Facts the question states never become components;
//   - a decision statement never has context.
export type Comp = string;

export interface ClaimSpec {
  support: Comp[][];
  contradict: Comp[][];
}

export interface ReferenceWorld {
  /** claim text -> what each stance requires */
  claims: Record<string, ClaimSpec>;
  /** investor text -> the components its own words establish */
  says: Record<string, Comp[]>;
  /** answers that state a reason for "the action under discussion" (the question resolves which action) */
  reasonAnswers: ReadonlySet<string>;
  /** question text -> the action/topic it poses. Never the facts it states. */
  asks: Record<string, Comp[]>;
}

export function referenceGate(world: ReferenceWorld, log: EvidenceGroundingCheckInput[] = []) {
  return async (input: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> => {
    log.push(input);
    const claim = world.claims[input.hypothesisStatement];
    const says = world.says[input.sourceAnswerText];
    if (!claim) throw new Error(`reference gate: unknown claim fixture: ${input.hypothesisStatement}`);
    if (!says) throw new Error(`reference gate: unknown text fixture: ${input.sourceAnswerText}`);

    const established = new Set<Comp>(says);
    const context = input.sourceKind === "decision_statement" ? undefined : input.contextText;
    if (context !== undefined && world.reasonAnswers.has(input.sourceAnswerText)) {
      for (const c of world.asks[context] ?? []) established.add(c);
    }

    const required = input.stance === "supporting" ? claim.support : claim.contradict;
    const ok = required.some((list) => list.every((c) => established.has(c)));
    return {
      verdict: ok ? "supported" : "unsupported",
      reason: ok
        ? `reference ${STANCE_SEMANTICS_VERSION}: every material component established by the investor's own words`
        : `reference ${STANCE_SEMANTICS_VERSION}: partial match or missing component — not evidence for the whole claim`,
    };
  };
}
