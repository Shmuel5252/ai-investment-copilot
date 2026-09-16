import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { evidence } from "@/db/schema";
import { selectEffectiveEvidence } from "@/lib/dna/effective-evidence";

export type NewEvidence = InferInsertModel<typeof evidence>;

// Immutable — this is the mechanism Traceable Judgments hangs on
// (docs/data-model.md §2). The exactly-one-subject / at-most-one-source
// invariants are enforced by CHECK constraints in the DB itself (see
// tests/integration/schema-constraints.test.ts), not just here.
export async function insertEvidence(db: typeof Db, values: NewEvidence) {
  const [row] = await db.insert(evidence).values(values).returning();
  return row!;
}

// Raw/historical — every Evidence row ever attached to this identity,
// unfiltered by version, exactly as before the DNA Grounding Remediation
// task. Never removed or narrowed: this is the one place the full
// citation history stays reachable regardless of what any one version's
// effective evidence looks like (see getEffectiveEvidenceForDnaHypothesisVersion
// below for the version-aware read). dna.generate's identity-matching
// step deliberately keeps using this raw form — matching against
// existing hypotheses must see everything ever cited, not just what the
// current version currently counts.
export async function getEvidenceForDnaHypothesis(db: typeof Db, dnaHypothesisId: string) {
  return db.query.evidence.findMany({
    where: (e, { eq }) => eq(e.dnaHypothesisId, dnaHypothesisId),
    orderBy: (e, { desc }) => desc(e.createdAt),
  });
}

// Version-aware/"effective" read (DNA Grounding Remediation task): what
// THIS specific version's own evidenceStrength/counts actually reflect,
// not the identity's full raw pool. Falls back to the full raw pool for
// any version with no persisted grounding-check rows (every version that
// predates this task, and every ordinary dna.generate new_version, which
// never writes to dna_evidence_grounding_checks) — see
// selectEffectiveEvidence's own comment for why that fallback is
// deliberate, not a gap.
export async function getEffectiveEvidenceForDnaHypothesisVersion(
  db: typeof Db,
  dnaHypothesisId: string,
  dnaHypothesisVersionId: string
) {
  const [rawEvidence, groundingChecks] = await Promise.all([
    getEvidenceForDnaHypothesis(db, dnaHypothesisId),
    getGroundingChecksForDnaHypothesisVersion(db, dnaHypothesisVersionId),
  ]);
  return selectEffectiveEvidence(rawEvidence, groundingChecks);
}

export async function getGroundingChecksForDnaHypothesisVersion(
  db: typeof Db,
  dnaHypothesisVersionId: string
) {
  return db.query.dnaEvidenceGroundingChecks.findMany({
    where: (c, { eq }) => eq(c.dnaHypothesisVersionId, dnaHypothesisVersionId),
  });
}

export async function getEvidenceForStrategyPrinciple(db: typeof Db, strategyPrincipleId: string) {
  return db.query.evidence.findMany({
    where: (e, { eq }) => eq(e.strategyPrincipleId, strategyPrincipleId),
    orderBy: (e, { desc }) => desc(e.createdAt),
  });
}

export async function getEvidenceForLearningInsight(db: typeof Db, learningInsightId: string) {
  return db.query.evidence.findMany({
    where: (e, { eq }) => eq(e.learningInsightId, learningInsightId),
    orderBy: (e, { desc }) => desc(e.createdAt),
  });
}
