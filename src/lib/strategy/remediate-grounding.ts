import type { EvidenceStrength } from "@/lib/dna/evidence-strength";
import {
  assessCitations,
  type EvidenceIndependenceResolver,
  type IndependenceBasis,
} from "@/lib/evidence/resolve-independence";
import type { EvidenceGroundingCheckInput, EvidenceGroundingResult } from "@/lib/ai/dna-grounding";
import type { PersistedEvidenceForRemediation } from "@/lib/dna/remediate-grounding";
import { statementIdOf } from "@/lib/evidence/statement-ref";

// Strategy Grounding + Identity Hardening task — the Strategy-specific
// mirror of src/lib/dna/remediate-grounding.ts's planGroundingRemediation.
// Same reasoning applies verbatim (see that file's own header comment for
// why this re-implements only the thin "loop + filter" shell once, over
// real Evidence ids, rather than reusing groundValidatedObservedPrinciples's
// loop, which has no ids to persist against). PersistedEvidenceForRemediation
// is reused directly from the DNA module — it's already fully generic
// ({id, interviewAnswerId, stance}), carrying no DNA-specific semantics.
export type { PersistedEvidenceForRemediation };

export type StrategyRemediationGroundingFn = (
  input: EvidenceGroundingCheckInput
) => Promise<EvidenceGroundingResult>;

export interface CurrentPrincipleVersionForRemediation {
  id: string;
  statementText: string;
  /** Carried through unchanged to the new version, if one is created — remediation never reclassifies a principle's tier. */
  principleType: "declared" | "observed" | "validated";
}

export interface RemediationCheckResult {
  evidenceId: string;
  verdict: "supported" | "unsupported";
  reason: string;
}

export interface RemediationNewPrincipleVersion {
  statementText: string;
  principleType: "declared" | "observed" | "validated";
  evidenceStrength: EvidenceStrength;
  supportingEvidenceCount: number;
  contradictingEvidenceCount: number;
  independenceBasis: IndependenceBasis;
  changeReason: string;
}

export type PrincipleRemediationPlan =
  | { action: "no_op" }
  | { action: "checked_no_change"; checks: RemediationCheckResult[] }
  | { action: "new_version"; checks: RemediationCheckResult[]; version: RemediationNewPrincipleVersion };

export interface PlanPrincipleGroundingRemediationInput {
  currentVersion: CurrentPrincipleVersionForRemediation;
  /** Every Evidence row currently persisted for this principle IDENTITY — raw and unfiltered, since Evidence has no version scoping of its own. */
  rawEvidence: readonly PersistedEvidenceForRemediation[];
  answerTextById: ReadonlyMap<string, string>;
  /** The SAME shared independence resolver DNA counts through. */
  independence: EvidenceIndependenceResolver;
  /** Evidence ids already logged "supported" against currentVersion.id, or null if this version has never been checked at all. */
  alreadyGroundedEvidenceIds: ReadonlySet<string> | null;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function buildChangeReason(
  checks: readonly RemediationCheckResult[],
  baselineIds: ReadonlySet<string>
): string {
  const newlyExcluded = checks.filter((c) => c.verdict === "unsupported" && baselineIds.has(c.evidenceId));
  const newlyIncluded = checks.filter((c) => c.verdict === "supported" && !baselineIds.has(c.evidenceId));

  const parts: string[] = [];
  if (newlyExcluded.length > 0) {
    parts.push(
      `${newlyExcluded.length} previously-counted citation(s) no longer grounded under Evidence Grounding: ` +
        newlyExcluded.map((c) => `evidence ${c.evidenceId} (${c.reason})`).join("; ")
    );
  }
  if (newlyIncluded.length > 0) {
    parts.push(
      `${newlyIncluded.length} previously-excluded citation(s) now grounded: ` +
        newlyIncluded.map((c) => `evidence ${c.evidenceId} (${c.reason})`).join("; ")
    );
  }
  return parts.length > 0
    ? `Retroactive re-validation under Evidence Grounding (dna-grounding.ts): ${parts.join(" ")}`
    : "Retroactive re-validation under Evidence Grounding found no change to the effective evidence set.";
}

// Fail-closed, like every other grounding-adjacent function: a citation
// this function cannot judge (missing answer text, a thrown grounding
// call) is treated as unsupported, never silently kept.
export async function planPrincipleGroundingRemediation(
  input: PlanPrincipleGroundingRemediationInput,
  checkGrounding: StrategyRemediationGroundingFn
): Promise<PrincipleRemediationPlan> {
  const { currentVersion, rawEvidence, answerTextById, independence, alreadyGroundedEvidenceIds } = input;

  const checks: RemediationCheckResult[] = [];
  const freshSupportedIds = new Set<string>();

  for (const ev of rawEvidence) {
    const statementId = statementIdOf(ev);
    if (statementId === null) {
      // Nothing to ground against — Evidence Grounding only ever judges a
      // claim against real InterviewAnswer.answerText. Still gets its own
      // "supported by convention" check row when a plan is persisted, so
      // it can never silently vanish from effective evidence once other
      // citations on the same version have been checked (the all-or-nothing
      // completeness invariant getEffectiveEvidenceForStrategyPrincipleVersion
      // depends on).
      checks.push({
        evidenceId: ev.id,
        verdict: "supported",
        reason: "Not subject to Evidence Grounding (no linked InterviewAnswer) — counted by convention, not by AI judgment.",
      });
      freshSupportedIds.add(ev.id);
      continue;
    }

    const sourceAnswerText = answerTextById.get(statementId);
    if (sourceAnswerText === undefined) {
      checks.push({
        evidenceId: ev.id,
        verdict: "unsupported",
        reason: "Source answer text unavailable — failing closed.",
      });
      continue;
    }

    let verdict: EvidenceGroundingResult;
    try {
      verdict = await checkGrounding({
        hypothesisStatement: currentVersion.statementText,
        stance: ev.stance,
        sourceAnswerText,
      });
    } catch {
      verdict = { verdict: "unsupported", reason: "Grounding check threw — failing closed." };
    }

    checks.push({ evidenceId: ev.id, verdict: verdict.verdict, reason: verdict.reason });
    if (verdict.verdict === "supported") freshSupportedIds.add(ev.id);
  }

  const baselineIds = alreadyGroundedEvidenceIds ?? new Set(rawEvidence.map((e) => e.id));
  const materiallyChanged = !setsEqual(baselineIds, freshSupportedIds);

  if (!materiallyChanged) {
    return alreadyGroundedEvidenceIds === null ? { action: "checked_no_change", checks } : { action: "no_op" };
  }

  const survivingEvidence = rawEvidence.filter((e) => freshSupportedIds.has(e.id));
  const assessed = assessCitations(
    independence,
    survivingEvidence.map((e) => ({ interviewAnswerId: e.interviewAnswerId, decisionStatement: e.decisionStatement ?? null, stance: e.stance, evidenceId: e.id }))
  );

  return {
    action: "new_version",
    checks,
    version: {
      statementText: currentVersion.statementText,
      principleType: currentVersion.principleType,
      evidenceStrength: assessed.evidenceStrength,
      supportingEvidenceCount: assessed.supportingCount,
      contradictingEvidenceCount: assessed.contradictingCount,
      independenceBasis: assessed.independenceBasis,
      changeReason: buildChangeReason(checks, baselineIds),
    },
  };
}
