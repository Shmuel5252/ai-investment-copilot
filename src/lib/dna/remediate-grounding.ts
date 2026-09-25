import type { EvidenceStrength } from "./evidence-strength";
import {
  assessCitations,
  type EvidenceIndependenceResolver,
  type IndependenceBasis,
} from "@/lib/evidence/resolve-independence";
import type { EvidenceGroundingCheckInput, EvidenceGroundingResult } from "@/lib/ai/dna-grounding";
import { statementIdOf, type DecisionStatementRef } from "@/lib/evidence/statement-ref";

// DNA Grounding Remediation — a SEPARATE orchestration from
// groundValidatedHypotheses() (ground-evidence.ts), even though both
// call the same injected grounding function and both recompute counts
// via the same shared independence resolver (assessCitations). That
// one runs BEFORE anything is persisted, over AI-proposed evidence that
// has no database row yet (ValidatedEvidence has no `id`). This one runs
// AFTER persistence, re-checking evidence that already has a real
// Evidence.id — and that id is exactly what has to be written to
// dna_evidence_grounding_checks and compared for idempotency across
// repeated runs. Reusing groundValidatedHypotheses's loop directly isn't
// possible without either losing that id or relying on undocumented call
// ordering; this file re-implements only that thin "loop + filter" shell
// once, over real ids, and still calls straight through to the two real
// named production helpers underneath — never a second Evidence Strength
// or independent-case-counting implementation.
export type RemediationGroundingFn = (
  input: EvidenceGroundingCheckInput
) => Promise<EvidenceGroundingResult>;

export interface PersistedEvidenceForRemediation {
  /** The real Evidence.id — required so a verdict can be persisted against a specific row (dna_evidence_grounding_checks.evidence_id). */
  id: string;
  /** null for Evidence sourced from something other than an InterviewAnswer (e.g. a LearningInsight agreement, a manual note) — Evidence Grounding only ever judges against real answerText, so such rows are never sent through grounding at all (see below). */
  interviewAnswerId: string | null;
  /** Evidence Reach V1: a decision-statement citation (then interviewAnswerId is null); grounded against the statement text like an answer. */
  decisionStatement?: DecisionStatementRef | null;
  stance: "supporting" | "contradicting";
}

export interface CurrentVersionForRemediation {
  id: string;
  statementText: string;
}

export interface RemediationCheckResult {
  evidenceId: string;
  verdict: "supported" | "unsupported";
  reason: string;
}

export interface RemediationNewVersion {
  statementText: string;
  evidenceStrength: EvidenceStrength;
  supportingEvidenceCount: number;
  contradictingEvidenceCount: number;
  independenceBasis: IndependenceBasis;
  changeReason: string;
}

export type RemediationPlan =
  // Already checked before, and re-running grounding now produces the
  // exact same effective evidence set — nothing to write at all, not
  // even a repeat grounding-check row (idempotency: re-running
  // remediation against an already-remediated, unchanged state is a
  // true no-op).
  | { action: "no_op" }
  // Never checked before, and every raw citation survives grounding —
  // the legacy baseline ("all raw evidence counts") already matches the
  // grounded result, so no new version is warranted, but the check rows
  // are still worth persisting: without them this version stays
  // indistinguishable from one that was never checked at all.
  | { action: "checked_no_change"; checks: RemediationCheckResult[] }
  // The effective evidence set differs from what the current version
  // reflects — grounds a new append-only version (statementText carried
  // over unchanged; only the evidence composition/counts differ) plus
  // the grounding-check rows that justify it, including checks for
  // citations that still survive (an auditor must be able to see the
  // full picture for the new version, not only what changed).
  | { action: "new_version"; checks: RemediationCheckResult[]; version: RemediationNewVersion };

export interface PlanGroundingRemediationInput {
  currentVersion: CurrentVersionForRemediation;
  /** Every Evidence row currently persisted for this hypothesis IDENTITY — raw and unfiltered, since Evidence itself has no version scoping of its own (docs/data-model.md §2). */
  rawEvidence: readonly PersistedEvidenceForRemediation[];
  /** answer.id -> real, persisted answerText — the sole source of truth for grounding, exactly as checkEvidenceGrounding requires. Never the evidence row's own AI-written description. */
  answerTextById: ReadonlyMap<string, string>;
  /** The SAME shared independence resolver dna.generate counts through — never a second construction of it here. */
  independence: EvidenceIndependenceResolver;
  /**
   * Evidence ids already logged "supported" against currentVersion.id via
   * a prior dna_evidence_grounding_checks pass. `null` means this version
   * has never been checked at all — its implicit baseline is "every raw
   * Evidence row counts," the legacy behavior every version before this
   * task relied on (getEvidenceForDnaHypothesis's unfiltered read).
   */
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
export async function planGroundingRemediation(
  input: PlanGroundingRemediationInput,
  checkGrounding: RemediationGroundingFn
): Promise<RemediationPlan> {
  const { currentVersion, rawEvidence, answerTextById, independence, alreadyGroundedEvidenceIds } = input;

  const checks: RemediationCheckResult[] = [];
  const freshSupportedIds = new Set<string>();

  for (const ev of rawEvidence) {
    const statementId = statementIdOf(ev);
    if (statementId === null) {
      // Nothing to ground against (e.g. a LearningInsight-sourced
      // agreement, or a manual note) — Evidence Grounding only ever
      // judges a claim against real InterviewAnswer.answerText, so this
      // citation is never sent to the injected grounding function. It
      // still needs its OWN check row here (verdict "supported" by
      // convention, not by a real grounding judgment) — omitting it
      // entirely would be a real bug: getEffectiveEvidenceForDnaHypothesisVersion
      // treats "this version has ANY check rows at all" as "only
      // explicitly-checked-supported evidence is effective," so a
      // persisted version with grounding-check rows for every OTHER
      // citation but none for this one would silently make this citation
      // invisible in "View Evidence" even though supportingEvidenceCount
      // correctly includes it — displayed counts and effective evidence
      // would disagree. Recording it here keeps `checks` a complete,
      // 1:1 map over rawEvidence whenever a plan is actually persisted.
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
      // Shouldn't happen for a real, persisted citation — fail closed,
      // same convention as ground-evidence.ts's own defensive branch.
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
      evidenceStrength: assessed.evidenceStrength,
      supportingEvidenceCount: assessed.supportingCount,
      contradictingEvidenceCount: assessed.contradictingCount,
      independenceBasis: assessed.independenceBasis,
      changeReason: buildChangeReason(checks, baselineIds),
    },
  };
}
