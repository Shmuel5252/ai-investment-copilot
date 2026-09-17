import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import { countIndependentCases } from "@/lib/evidence/count-independent-cases";
import type { ValidatedObservedPrinciple, ValidatedPrincipleEvidence } from "./validate-principles";
import type { HypothesisMatchCandidate, HypothesisMatchResult } from "@/lib/ai/dna-identity";

// Strategy Grounding + Identity Hardening task — the Strategy-specific
// mirror of src/lib/dna/resolve-hypothesis-identity.ts's
// resolveHypothesisIdentities. generateObserved used to insert a
// brand-new strategyPrinciples identity for every proposal that survived
// validation+grounding, unconditionally — nothing checked it against
// existing active OBSERVED principles, or against other proposals in the
// SAME batch, for being the same underlying claim (confirmed by direct
// code trace, not inferred: insertObservedPrincipleWithEvidence always
// does tx.insert(strategyPrinciples)...).
//
// classifyHypothesisMatch (src/lib/ai/dna-identity.ts) is reused
// UNMODIFIED — re-verified before wiring it in: its interface
// ({statement, candidates: {id, statementText}[]}) and its prompt
// ("a proposed behavioral claim about an investor") carry no DNA-specific
// vocabulary or types, and an observed Strategy principle is exactly that
// kind of claim. No Strategy-specific adapter or prompt fork was needed.
//
// The ONE genuinely Strategy-specific difference from DNA (not a
// mechanical port): strategyPrinciples is a HETEROGENEOUS identity table
// shared by three principleTypes (declared/observed/validated) — DNA's
// dnaHypotheses table has no such split. Matching a freshly-generated
// OBSERVED proposal must only ever consider EXISTING principles whose
// current version is ALSO observed — declared and validated/system-default
// principles must never be candidates, or a freshly-noticed pattern could
// nonsensically "match" and version-bump the investor's own verbatim
// declared statement, or a fixed system default. filterToObservedCandidates
// below is the one, directly-testable place this boundary is enforced —
// the router calls it before building `existing`, so this exact function
// (not a copy, not an inline filter reimplemented at the call site) is
// what a test exercises too.
export interface PrincipleForCandidateFiltering {
  id: string;
  versions: { principleType: string }[];
}

export function filterToObservedCandidates<T extends PrincipleForCandidateFiltering>(
  principles: readonly T[]
): T[] {
  return principles.filter((p) => p.versions[0]?.principleType === "observed");
}

export type ObservedPrincipleMatchFn = (
  proposedStatement: string,
  candidates: readonly HypothesisMatchCandidate[]
) => Promise<HypothesisMatchResult>;

export interface ExistingEvidenceForCounting {
  interviewAnswerId: string;
  stance: "supporting" | "contradicting";
}

export interface ExistingObservedPrincipleForMatching {
  id: string;
  statementText: string;
  /** Every already-persisted Evidence citation for this identity, across all its versions — Evidence rows are keyed by the identity, not the version, so this is naturally cumulative. MUST already be filtered by the caller to identities whose current version has principleType==="observed" — see this module's own header comment. */
  evidenceForCounting: ExistingEvidenceForCounting[];
}

export type PrincipleIdentityResolution =
  | {
      action: "new_identity";
      statement: string;
      evidence: ValidatedPrincipleEvidence[];
      supportingCount: number;
      contradictingCount: number;
      evidenceStrength: EvidenceStrength;
    }
  | {
      action: "new_version";
      principleId: string;
      statement: string;
      /** Only the genuinely-new citations to insert — already-persisted evidence for this identity is never re-inserted. */
      newEvidence: ValidatedPrincipleEvidence[];
      /** Recomputed over the FULL combined (old + new) evidence set — never inherited from the previous version. */
      supportingCount: number;
      contradictingCount: number;
      evidenceStrength: EvidenceStrength;
    }
  | {
      // Matched an existing identity, but every cited case was already
      // represented in its existing evidence — genuinely nothing new was
      // learned. No DB write at all.
      action: "no_new_information";
      principleId: string;
      statement: string;
    };

function dedupeEvidence(evidence: readonly ValidatedPrincipleEvidence[]): ValidatedPrincipleEvidence[] {
  const seen = new Set<string>();
  const result: ValidatedPrincipleEvidence[] = [];
  for (const e of evidence) {
    const key = `${e.interviewAnswerId}::${e.stance}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(e);
  }
  return result;
}

interface Group {
  id: string;
  statement: string;
  isExisting: boolean;
  existingEvidenceForCounting: ExistingEvidenceForCounting[];
  newEvidence: ValidatedPrincipleEvidence[];
}

export async function resolveObservedPrincipleIdentities(
  groundedPrinciples: readonly ValidatedObservedPrinciple[],
  existing: readonly ExistingObservedPrincipleForMatching[],
  answerCaseKeys: ReadonlyMap<string, string>,
  classifyMatch: ObservedPrincipleMatchFn
): Promise<PrincipleIdentityResolution[]> {
  const pool: HypothesisMatchCandidate[] = existing.map((p) => ({ id: p.id, statementText: p.statementText }));
  const groups = new Map<string, Group>();
  for (const p of existing) {
    groups.set(p.id, {
      id: p.id,
      statement: p.statementText,
      isExisting: true,
      existingEvidenceForCounting: p.evidenceForCounting,
      newEvidence: [],
    });
  }

  let syntheticCounter = 0;

  for (const principle of groundedPrinciples) {
    const match = await classifyMatch(principle.statement, pool);
    const target = match.matchedId !== null ? groups.get(match.matchedId) : undefined;

    if (target) {
      target.newEvidence.push(...principle.evidence);
    } else {
      syntheticCounter += 1;
      const newId = `__new_${syntheticCounter}__`;
      groups.set(newId, {
        id: newId,
        statement: principle.statement,
        isExisting: false,
        existingEvidenceForCounting: [],
        newEvidence: [...principle.evidence],
      });
      // Available for later proposals in this SAME batch to match against
      // — this is the entire within-batch-duplicate mechanism.
      pool.push({ id: newId, statementText: principle.statement });
    }
  }

  const resolutions: PrincipleIdentityResolution[] = [];

  for (const group of groups.values()) {
    if (group.newEvidence.length === 0) continue; // an existing principle nothing in this batch touched

    const dedupedNewEvidence = dedupeEvidence(group.newEvidence);

    if (group.isExisting) {
      // Defensive, same reasoning as resolve-hypothesis-identity.ts: an
      // already-persisted citation's InterviewAnswer isn't guaranteed
      // resolvable at read time (nothing supersedes one today, but
      // nothing here should assume it never will) — excluding an
      // unresolvable old citation is the conservative choice.
      const resolvableExisting = group.existingEvidenceForCounting.filter((e) =>
        answerCaseKeys.has(e.interviewAnswerId)
      );
      const oldCaseKeys = new Set(resolvableExisting.map((e) => answerCaseKeys.get(e.interviewAnswerId)!));
      const combinedForCounting = [...resolvableExisting, ...dedupedNewEvidence];
      const combinedCaseKeys = new Set(combinedForCounting.map((e) => answerCaseKeys.get(e.interviewAnswerId)!));

      const genuinelyNew = combinedCaseKeys.size > oldCaseKeys.size;

      if (!genuinelyNew) {
        resolutions.push({ action: "no_new_information", principleId: group.id, statement: group.statement });
        continue;
      }

      const { supportingCount, contradictingCount } = countIndependentCases(
        combinedForCounting,
        (e) => answerCaseKeys.get(e.interviewAnswerId)!
      );
      const alreadyPersisted = new Set(
        group.existingEvidenceForCounting.map((e) => `${e.interviewAnswerId}::${e.stance}`)
      );
      const evidenceToInsert = dedupedNewEvidence.filter(
        (e) => !alreadyPersisted.has(`${e.interviewAnswerId}::${e.stance}`)
      );
      resolutions.push({
        action: "new_version",
        principleId: group.id,
        statement: group.statement,
        newEvidence: evidenceToInsert,
        supportingCount,
        contradictingCount,
        evidenceStrength: calculateEvidenceStrength(supportingCount, contradictingCount),
      });
    } else {
      const { supportingCount, contradictingCount } = countIndependentCases(
        dedupedNewEvidence,
        (e) => answerCaseKeys.get(e.interviewAnswerId)!
      );
      resolutions.push({
        action: "new_identity",
        statement: group.statement,
        evidence: dedupedNewEvidence,
        supportingCount,
        contradictingCount,
        evidenceStrength: calculateEvidenceStrength(supportingCount, contradictingCount),
      });
    }
  }

  return resolutions;
}
