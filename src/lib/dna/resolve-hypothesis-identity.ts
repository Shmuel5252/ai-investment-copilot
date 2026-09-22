import type { EvidenceStrength } from "./evidence-strength";
import {
  assessCitations,
  type EvidenceIndependenceResolver,
  type IndependenceBasis,
} from "@/lib/evidence/resolve-independence";
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
  /**
   * The EFFECTIVE evidence of the identity's CURRENT version — what its
   * counts actually reflect (see src/lib/evidence/identity-evidence-for-counting.ts).
   * Never the raw pool: raw Evidence is immutable provenance and includes
   * citations a grounding remediation rejected.
   */
  evidenceForCounting: ExistingEvidenceForCounting[];
  /**
   * Citations the identity's CURRENT version explicitly excluded (grounding
   * remediation verdict "unsupported", or no verdict on a checked version).
   * They stay excluded: re-presenting one — even if grounding happens to
   * accept it this time — neither counts nor mints a version. An explicit
   * rejection is only ever revisited by an explicit re-grounding (remediation),
   * never by identity resolution, so AI nondeterminism cannot raise confidence.
   * Empty for a version with no grounding checks (the approved legacy fallback).
   */
  rejectedEvidence: ExistingEvidenceForCounting[];
}

export type IdentityResolution =
  | {
      action: "new_identity";
      statement: string;
      evidence: ValidatedEvidence[];
      supportingCount: number;
      contradictingCount: number;
      evidenceStrength: EvidenceStrength;
      independenceBasis: IndependenceBasis;
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
      independenceBasis: IndependenceBasis;
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
  /** "answerId::stance" keys the identity's current version explicitly excluded. */
  rejected: ReadonlySet<string>;
  /** A proposal in this batch matched (or created) this group — even if every citation was suppressed. */
  touched: boolean;
  newEvidence: ValidatedEvidence[];
}

export async function resolveHypothesisIdentities(
  groundedHypotheses: readonly ValidatedHypothesis[],
  existing: readonly ExistingHypothesisForMatching[],
  independence: EvidenceIndependenceResolver,
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
      rejected: new Set(h.rejectedEvidence.map((e) => `${e.interviewAnswerId}::${e.stance}`)),
      touched: false,
      newEvidence: [],
    });
  }

  let syntheticCounter = 0;

  for (const hypothesis of groundedHypotheses) {
    const match = await classifyMatch(hypothesis.statement, pool);
    const target = match.matchedId !== null ? groups.get(match.matchedId) : undefined;

    if (target) {
      target.touched = true;
      target.newEvidence.push(
        ...hypothesis.evidence.filter((e) => !target.rejected.has(`${e.interviewAnswerId}::${e.stance}`))
      );
    } else {
      syntheticCounter += 1;
      const newId = `__new_${syntheticCounter}__`;
      groups.set(newId, {
        id: newId,
        statement: hypothesis.statement,
        isExisting: false,
        existingEvidenceForCounting: [],
        rejected: new Set(),
        touched: true,
        newEvidence: [...hypothesis.evidence],
      });
      // Available for later proposals in this SAME batch to match against
      // — this is the entire within-batch-duplicate mechanism.
      pool.push({ id: newId, statementText: hypothesis.statement });
    }
  }

  const resolutions: IdentityResolution[] = [];

  for (const group of groups.values()) {
    if (!group.touched) continue; // an existing hypothesis nothing in this batch touched
    if (group.newEvidence.length === 0) {
      // Matched, but every cited pair is one this identity's current version explicitly rejected.
      resolutions.push({ action: "no_new_information", hypothesisId: group.id, statement: group.statement });
      continue;
    }

    const dedupedNewEvidence = dedupeEvidence(group.newEvidence);

    if (group.isExisting) {
      // Defensive: every CURRENTLY-proposed citation is already
      // guaranteed resolvable (validateProposedHypotheses only lets
      // through ids independence.hasAnswer()), but an already-PERSISTED
      // citation from an earlier round has no such guarantee at read
      // time — if its InterviewAnswer were ever superseded (no code path
      // does this today, but nothing here should assume it never will),
      // it would no longer be resolvable at all. Excluding an
      // unresolvable old citation from this round's comparison is the
      // conservative choice: at worst it very slightly undercounts how
      // much was already known, never invents a case that doesn't exist.
      const resolvableExisting = group.existingEvidenceForCounting.filter((e) =>
        independence.hasAnswer(e.interviewAnswerId)
      );
      const oldGroupCount = independence.resolve(resolvableExisting).groups.length;
      const combinedForCounting = [...resolvableExisting, ...dedupedNewEvidence];
      const combined = assessCitations(independence, combinedForCounting);

      // Recording a new citation is NOT proving a new independent case. A
      // citation that lands in an already-counted STRONG group (same
      // position episode, or joined by a confirmed LinkFact) adds nothing
      // and must not mint a version. A citation that only a WEAK edge ties
      // to an existing group is still a possibly-independent case: it is
      // recorded (evidence is never dropped on a maybe) and S_lb simply
      // does not rise for it. The strong-group count can only grow when new
      // evidence adds a group; it can shrink only if a new citation bridges
      // two existing groups, which is likewise not "a new case".
      const genuinelyNew = combined.independenceBasis.groups.length > oldGroupCount;

      if (!genuinelyNew) {
        resolutions.push({ action: "no_new_information", hypothesisId: group.id, statement: group.statement });
        continue;
      }

      // What actually gets INSERTED excludes any (answer, stance) pair
      // already persisted for this identity in an earlier round — a
      // re-citation of the same answer with the same stance contributes
      // no new information and must not appear twice in "View Evidence".
      // This never affects the count above: the resolver already collapses
      // by group regardless of how many raw citations map to it, so
      // removing an exact-duplicate raw citation before insertion changes
      // nothing about the groups already computed.
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
        supportingCount: combined.supportingCount,
        contradictingCount: combined.contradictingCount,
        evidenceStrength: combined.evidenceStrength,
        independenceBasis: combined.independenceBasis,
      });
    } else {
      resolutions.push({
        action: "new_identity",
        statement: group.statement,
        evidence: dedupedNewEvidence,
        ...assessCitations(independence, dedupedNewEvidence),
      });
    }
  }

  return resolutions;
}
