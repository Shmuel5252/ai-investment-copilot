import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { evidence } from "@/db/schema";
import { selectEffectiveEvidence } from "@/lib/dna/effective-evidence";
import { partitionEvidenceForCounting } from "@/lib/evidence/identity-evidence-for-counting";

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
// below for the version-aware read). Audit and remediation read this raw
// form. dna.generate's identity matching does NOT: it decides "what is
// already counted" from getCountingEvidenceForDnaVersion (the effective
// evidence of the CURRENT version), because counting a citation that
// grounding rejected would re-inflate S/C on the next generation.
export async function getEvidenceForDnaHypothesis(db: typeof Db, dnaHypothesisId: string) {
  return db.query.evidence.findMany({
    where: (e, { eq }) => eq(e.dnaHypothesisId, dnaHypothesisId),
    orderBy: (e, { desc }) => desc(e.createdAt),
  });
}

// Version-aware/"effective" read (DNA Grounding Remediation task): what
// THIS specific version's own evidenceStrength/counts actually reflect,
// not the identity's full raw pool. Falls back to the full raw pool for
// any version with no persisted grounding-check rows (every legacy /
// never-remediated version) — see selectEffectiveEvidence's own comment
// for why that fallback is deliberate. A dna.generate new_version appended
// to an identity whose current version HAS checks now carries them forward
// (checksForAppendedVersion), so it never falls back to raw by accident.
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

// What dna.generate's identity matching counts against: the effective
// evidence of the identity's CURRENT version, plus the citations that
// version explicitly excluded (which must not re-enter counts).
export async function getCountingEvidenceForDnaVersion(
  db: typeof Db,
  dnaHypothesisId: string,
  dnaHypothesisVersionId: string
) {
  const [rawEvidence, groundingChecks] = await Promise.all([
    getEvidenceForDnaHypothesis(db, dnaHypothesisId),
    getGroundingChecksForDnaHypothesisVersion(db, dnaHypothesisVersionId),
  ]);
  return partitionEvidenceForCounting(rawEvidence, groundingChecks);
}

export async function getGroundingChecksForDnaHypothesisVersion(
  db: typeof Db,
  dnaHypothesisVersionId: string
) {
  return db.query.dnaEvidenceGroundingChecks.findMany({
    where: (c, { eq }) => eq(c.dnaHypothesisVersionId, dnaHypothesisVersionId),
  });
}

// Raw/historical — Strategy's mirror of getEvidenceForDnaHypothesis
// above, unchanged in behavior. Every Evidence row ever attached to this
// Strategy principle identity, unfiltered by version. Never narrowed —
// audit and remediation read it; generateObserved's identity matching
// counts against getCountingEvidenceForStrategyPrincipleVersion instead,
// same reasoning as DNA's.
export async function getEvidenceForStrategyPrinciple(db: typeof Db, strategyPrincipleId: string) {
  return db.query.evidence.findMany({
    where: (e, { eq }) => eq(e.strategyPrincipleId, strategyPrincipleId),
    orderBy: (e, { desc }) => desc(e.createdAt),
  });
}

// Version-aware/"effective" read (Strategy Grounding + Identity
// Hardening task) — Strategy's mirror of
// getEffectiveEvidenceForDnaHypothesisVersion above. Falls back to the
// full raw pool for any version with no persisted grounding-check rows
// (every legacy / never-remediated version). A generateObserved
// new_version appended to a principle whose current version HAS checks
// carries them forward, so it never falls back to raw by accident.
export async function getEffectiveEvidenceForStrategyPrincipleVersion(
  db: typeof Db,
  strategyPrincipleId: string,
  strategyPrincipleVersionId: string
) {
  const [rawEvidence, groundingChecks] = await Promise.all([
    getEvidenceForStrategyPrinciple(db, strategyPrincipleId),
    getGroundingChecksForStrategyPrincipleVersion(db, strategyPrincipleVersionId),
  ]);
  return selectEffectiveEvidence(rawEvidence, groundingChecks);
}

// Strategy's mirror of getCountingEvidenceForDnaVersion.
export async function getCountingEvidenceForStrategyPrincipleVersion(
  db: typeof Db,
  strategyPrincipleId: string,
  strategyPrincipleVersionId: string
) {
  const [rawEvidence, groundingChecks] = await Promise.all([
    getEvidenceForStrategyPrinciple(db, strategyPrincipleId),
    getGroundingChecksForStrategyPrincipleVersion(db, strategyPrincipleVersionId),
  ]);
  return partitionEvidenceForCounting(rawEvidence, groundingChecks);
}

export async function getGroundingChecksForStrategyPrincipleVersion(
  db: typeof Db,
  strategyPrincipleVersionId: string
) {
  return db.query.strategyEvidenceGroundingChecks.findMany({
    where: (c, { eq }) => eq(c.strategyPrincipleVersionId, strategyPrincipleVersionId),
  });
}

export async function getEvidenceForLearningInsight(db: typeof Db, learningInsightId: string) {
  return db.query.evidence.findMany({
    where: (e, { eq }) => eq(e.learningInsightId, learningInsightId),
    orderBy: (e, { desc }) => desc(e.createdAt),
  });
}
