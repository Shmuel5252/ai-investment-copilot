import { calculateEvidenceStrength, type EvidenceStrength } from "./evidence-strength";
import { countIndependentCases } from "@/lib/evidence/count-independent-cases";
import type { ValidatedEvidence, ValidatedHypothesis } from "./validate-hypotheses";
import type { HypothesisMatchCandidate, HypothesisMatchResult } from "@/lib/ai/dna-identity";

// Hypothesis Identity — runs AFTER Evidence Grounding, on the surviving
// grounded hypotheses only. Every dna.generate call used to insert a
// brand-new DNAHypothesis identity for every proposal that survived
// validation, unconditionally — nothing checked it against existing
// active hypotheses, or against other proposals in the SAME batch, for
// being the same underlying claim. Real examples this fixes: an old
// "cautious about leverage" hypothesis and a freshly proposed "avoid
// leveraged/speculative instruments" hypothesis (same claim, different
// generations); two proposals in one batch ("realize profits gradually
// to redeploy capital" / "sell a profitable position for a new
// opportunity") that were the same observation split in two.
//
// One classification primitive (classifyHypothesisMatch, dependency-
// injected — see resolveHypothesisIdentities's own signature) does BOTH
// jobs: matching against pre-existing active hypotheses AND catching
// within-batch duplicates, by growing the SAME candidate pool as new
// batch groups get created — a proposal that doesn't match anything
// existing becomes a new candidate later proposals in this same batch can
// still match against. No separate "batch dedup" mechanism, no new state
// machine.
export type HypothesisMatchFn = (
  proposedStatement: string,
  candidates: readonly HypothesisMatchCandidate[]
) => Promise<HypothesisMatchResult>;

export interface ExistingEvidenceForCounting {
  interviewAnswerId: string;
  stance: "supporting" | "contradicting";
}

export interface ExistingHypothesisForMatching {
  id: string;
  statementText: string;
  /** Every already-persisted Evidence citation for this identity, across all its versions — Evidence rows are keyed by the identity, not the version, so this is naturally cumulative. */
  evidenceForCounting: ExistingEvidenceForCounting[];
}

export type IdentityResolution =
  | {
      action: "new_identity";
      statement: string;
      evidence: ValidatedEvidence[];
      supportingCount: number;
      contradictingCount: number;
      evidenceStrength: EvidenceStrength;
    }
  | {
      action: "new_version";
      hypothesisId: string;
      statement: string;
      /** Only the genuinely-new citations to insert — already-persisted evidence for this identity is never re-inserted. */
      newEvidence: ValidatedEvidence[];
      /** Recomputed over the FULL combined (old + new) evidence set — never inherited from the previous version. */
      supportingCount: number;
      contradictingCount: number;
      evidenceStrength: EvidenceStrength;
    }
  | {
      // Matched an existing identity, but every cited case was already
      // represented in its existing evidence — genuinely nothing new was
      // learned. No DB write at all: no redundant version, no redundant
      // Evidence row. Simpler and safer than persisting a no-op version
      // or an untracked stray Evidence row that no version's counts
      // would reflect.
      action: "no_new_information";
      hypothesisId: string;
      statement: string;
    };

function dedupeEvidence(evidence: readonly ValidatedEvidence[]): ValidatedEvidence[] {
  const seen = new Set<string>();
  const result: ValidatedEvidence[] = [];
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
  newEvidence: ValidatedEvidence[];
}

export async function resolveHypothesisIdentities(
  groundedHypotheses: readonly ValidatedHypothesis[],
  existing: readonly ExistingHypothesisForMatching[],
  answerCaseKeys: ReadonlyMap<string, string>,
  classifyMatch: HypothesisMatchFn
): Promise<IdentityResolution[]> {
  const pool: HypothesisMatchCandidate[] = existing.map((h) => ({ id: h.id, statementText: h.statementText }));
  const groups = new Map<string, Group>();
  for (const h of existing) {
    groups.set(h.id, {
      id: h.id,
      statement: h.statementText,
      isExisting: true,
      existingEvidenceForCounting: h.evidenceForCounting,
      newEvidence: [],
    });
  }

  let syntheticCounter = 0;

  for (const hypothesis of groundedHypotheses) {
    const match = await classifyMatch(hypothesis.statement, pool);
    const target = match.matchedId !== null ? groups.get(match.matchedId) : undefined;

    if (target) {
      target.newEvidence.push(...hypothesis.evidence);
    } else {
      syntheticCounter += 1;
      const newId = `__new_${syntheticCounter}__`;
      groups.set(newId, {
        id: newId,
        statement: hypothesis.statement,
        isExisting: false,
        existingEvidenceForCounting: [],
        newEvidence: [...hypothesis.evidence],
      });
      // Available for later proposals in this SAME batch to match against
      // — this is the entire within-batch-duplicate mechanism.
      pool.push({ id: newId, statementText: hypothesis.statement });
    }
  }

  const resolutions: IdentityResolution[] = [];

  for (const group of groups.values()) {
    if (group.newEvidence.length === 0) continue; // an existing hypothesis nothing in this batch touched

    const dedupedNewEvidence = dedupeEvidence(group.newEvidence);

    if (group.isExisting) {
      // Defensive: every CURRENTLY-proposed citation is already
      // guaranteed resolvable (validateProposedHypotheses only lets
      // through ids answerCaseKeys.has()), but an already-PERSISTED
      // citation from an earlier round has no such guarantee at read
      // time — if its InterviewAnswer were ever superseded (no code path
      // does this today, but nothing here should assume it never will),
      // it would no longer appear in answerCaseKeys at all. Excluding an
      // unresolvable old citation from this round's comparison — rather
      // than trusting a non-null assertion into an incorrect `undefined`
      // key — is the conservative choice: at worst it very slightly
      // undercounts how much was already known, never invents a case
      // that doesn't exist.
      const resolvableExisting = group.existingEvidenceForCounting.filter((e) =>
        answerCaseKeys.has(e.interviewAnswerId)
      );
      const oldCaseKeys = new Set(resolvableExisting.map((e) => answerCaseKeys.get(e.interviewAnswerId)!));
      const combinedForCounting = [...resolvableExisting, ...dedupedNewEvidence];
      const combinedCaseKeys = new Set(combinedForCounting.map((e) => answerCaseKeys.get(e.interviewAnswerId)!));

      // combinedForCounting always includes every old citation, so this
      // set can never shrink relative to oldCaseKeys — a strict size
      // increase is both necessary and sufficient for "at least one
      // genuinely new independent case arrived this round".
      const genuinelyNew = combinedCaseKeys.size > oldCaseKeys.size;

      if (!genuinelyNew) {
        resolutions.push({ action: "no_new_information", hypothesisId: group.id, statement: group.statement });
        continue;
      }

      const { supportingCount, contradictingCount } = countIndependentCases(
        combinedForCounting,
        (e) => answerCaseKeys.get(e.interviewAnswerId)!
      );
      // What actually gets INSERTED excludes any (answer, stance) pair
      // already persisted for this identity in an earlier round — a
      // re-citation of the same answer with the same stance contributes
      // no new information and must not appear twice in "View Evidence".
      // This never affects the count above: countIndependentCases already
      // collapses by case key regardless of how many raw citations map to
      // it, so removing an exact-duplicate raw citation before insertion
      // changes nothing about the case-key set already computed.
      const alreadyPersisted = new Set(
        group.existingEvidenceForCounting.map((e) => `${e.interviewAnswerId}::${e.stance}`)
      );
      const evidenceToInsert = dedupedNewEvidence.filter(
        (e) => !alreadyPersisted.has(`${e.interviewAnswerId}::${e.stance}`)
      );
      resolutions.push({
        action: "new_version",
        hypothesisId: group.id,
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
