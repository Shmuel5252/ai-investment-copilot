// Pure decision logic behind getEffectiveEvidenceForDnaHypothesisVersion()
// (src/db/repositories/evidence.ts) — kept separate from the DB fetch so
// the actual filtering rule is directly unit-testable without a database
// (DNA Grounding Remediation task).
//
// Evidence itself has no version scoping (src/db/schema/evidence.ts —
// dnaHypothesisId points at the identity, not a version). Before this
// task every version transition only ever ADDED evidence, so "all raw
// evidence for the identity" and "everything the latest version counts"
// were always the same set. Remediation is the first case where a
// version's valid evidence set can be a strict SUBSET of the identity's
// full Evidence pool — this function is the single place that decides,
// for a given version, which is the correct read:
//   - a version with grounding-check rows -> only the citations logged
//     "supported" for THAT version (its effective/grounded evidence);
//   - a version with none at all -> every raw citation for the identity,
//     unchanged from the behavior every existing consumer already relies
//     on (never silently pretend an unchecked version was grounded).
//
// All-or-nothing invariant (independent-review hardening): whenever a
// version has ANY grounding-check rows at all, they are guaranteed
// complete — one row per raw Evidence row that existed for the identity
// at check time, never a partial subset. That completeness is enforced
// upstream, not here: planGroundingRemediation() (remediate-grounding.ts)
// always emits exactly one check result per raw evidence item passed to
// it — including citations with no linkable InterviewAnswer, which are
// never sent to the AI but still get an explicit "supported by
// convention" check row — and insertDnaHypothesisVersionWithGroundingChecks
// / insertGroundingChecksForVersion (src/db/repositories/dna.ts) persist
// a plan's version and its full check set inside a single transaction.
// Given that, a raw Evidence row with NO check row logged is only ever
// reachable through the "never checked at all" (empty groundingChecks)
// branch above — so treating "checked but absent from the supported set"
// as excluded, below, can never accidentally exclude something that was
// simply never audited. Never relax this to "assume supported when
// absent": that direction silently increases confidence in the face of
// a broken invariant, exactly what No Fake Certainty forbids.
export interface GroundingCheckForSelection {
  evidenceId: string;
  verdict: "supported" | "unsupported";
}

export function selectEffectiveEvidence<T extends { id: string }>(
  rawEvidence: readonly T[],
  groundingChecks: readonly GroundingCheckForSelection[]
): T[] {
  if (groundingChecks.length === 0) return [...rawEvidence];

  const supportedIds = new Set(
    groundingChecks.filter((c) => c.verdict === "supported").map((c) => c.evidenceId)
  );
  return rawEvidence.filter((e) => supportedIds.has(e.id));
}
