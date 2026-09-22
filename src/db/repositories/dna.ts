import { eq, desc, and, inArray } from "drizzle-orm";
import type { db as Db, DbOrTx } from "@/db/client";
import { dnaHypotheses, dnaHypothesisVersions, evidence, dnaEvidenceGroundingChecks } from "@/db/schema";
import type { InferInsertModel } from "drizzle-orm";
import type { ValidatedHypothesis } from "@/lib/dna/validate-hypotheses";
import { calculateEvidenceStrength } from "@/lib/dna/evidence-strength";
import type { RemediationCheckResult, RemediationNewVersion } from "@/lib/dna/remediate-grounding";
import type { IndependenceBasis } from "@/lib/evidence/resolve-independence";
import { isUniqueViolation, StaleIdentityVersionError } from "@/db/errors";
import { checksForAppendedVersion } from "@/lib/evidence/append-version-checks";
import {
  planConfidenceRecalculation,
  buildRecalculatedDnaVersion,
  carryForwardGroundingChecks,
  type ConfidenceRecalculationOutcome,
} from "@/lib/evidence/recalculate-confidence";
import {
  planIndependenceRecalculation,
  buildIndependenceRecalculatedDnaVersion,
  citationsFromEvidence,
  type IndependenceRecalculationOutcome,
} from "@/lib/evidence/recalculate-independence";
import { selectEffectiveEvidence } from "@/lib/dna/effective-evidence";
import type { EvidenceIndependenceResolver } from "@/lib/evidence/resolve-independence";

export type NewDnaHypothesis = InferInsertModel<typeof dnaHypotheses>;
export type NewDnaHypothesisVersion = InferInsertModel<typeof dnaHypothesisVersions>;

export async function insertDnaHypothesis(db: typeof Db, values: NewDnaHypothesis) {
  const [row] = await db.insert(dnaHypotheses).values(values).returning();
  return row!;
}

// Append-only — never call db.update(dnaHypothesisVersions) anywhere else.
export async function insertDnaHypothesisVersion(db: typeof Db, values: NewDnaHypothesisVersion) {
  const [row] = await db.insert(dnaHypothesisVersions).values(values).returning();
  return row!;
}

// DbOrTx (not typeof Db) so insertDnaHypothesisVersionWithEvidence below
// can read-then-insert inside one outer transaction, the same reasoning
// as insertTransactions in db/repositories/portfolio.ts.
export async function getLatestDnaHypothesisVersion(db: DbOrTx, dnaHypothesisId: string) {
  const [row] = await db
    .select()
    .from(dnaHypothesisVersions)
    .where(eq(dnaHypothesisVersions.dnaHypothesisId, dnaHypothesisId))
    .orderBy(desc(dnaHypothesisVersions.versionNumber))
    .limit(1);
  return row;
}

export async function listActiveDnaHypothesesForInvestor(db: typeof Db, investorId: string) {
  return db.query.dnaHypotheses.findMany({
    where: (h, { and, eq }) => and(eq(h.investorId, investorId), eq(h.status, "active")),
    with: {
      versions: { orderBy: (v, { desc }) => desc(v.versionNumber), limit: 1 },
    },
  });
}

// Writes a brand-new hypothesis (identity + first version) together
// with its already-validated Evidence rows, atomically. Called only
// with output from validateProposedHypotheses() — evidenceStrength and
// the supporting/contradicting counts are read from that validation
// result, never recomputed or trusted from raw AI output here.
export async function insertDnaHypothesisWithEvidence(
  db: typeof Db,
  investorId: string,
  hypothesis: ValidatedHypothesis
) {
  return db.transaction(async (tx) => {
    const [identity] = await tx.insert(dnaHypotheses).values({ investorId }).returning();
    const [version] = await tx
      .insert(dnaHypothesisVersions)
      .values({
        dnaHypothesisId: identity!.id,
        versionNumber: 1,
        statementText: hypothesis.statement,
        evidenceStrength: hypothesis.evidenceStrength,
        supportingEvidenceCount: hypothesis.supportingCount,
        contradictingEvidenceCount: hypothesis.contradictingCount,
        independenceBasisJson: hypothesis.independenceBasis,
        createdBy: "ai_generated",
      })
      .returning();

    await tx.insert(evidence).values(
      hypothesis.evidence.map((e) => ({
        dnaHypothesisId: identity!.id,
        stance: e.stance,
        interviewAnswerId: e.interviewAnswerId,
        description: e.description,
      }))
    );

    return { hypothesis: identity!, version: version! };
  });
}

// "סגירת הלולאה ל-DNA" (docs/data-model.md §8): the investor agreeing
// with a Learning Insight creates a brand-new DNA hypothesis (not an
// edit of an existing one — there's no single obviously-right hypothesis
// to attach this to) whose only evidence, at least at first, is that
// agreement itself — sourced from the LearningInsight via
// `Evidence.sourceLearningInsightId` (the column added in this same
// task specifically to make this representable, see schema/evidence.ts).
// evidenceStrength is computed the normal way (1 supporting, 0
// contradicting -> insufficient_evidence) — one agreement is real
// evidence, but honestly not enough on its own; more accumulates the
// normal way as the investor answers more interviews or agrees with more
// insights citing the same pattern.
export async function insertDnaHypothesisFromLearningInsight(
  db: typeof Db,
  investorId: string,
  learningInsightId: string,
  statementText: string
) {
  return db.transaction(async (tx) => {
    const [identity] = await tx.insert(dnaHypotheses).values({ investorId }).returning();
    const [version] = await tx
      .insert(dnaHypothesisVersions)
      .values({
        dnaHypothesisId: identity!.id,
        versionNumber: 1,
        statementText,
        evidenceStrength: calculateEvidenceStrength(1, 0),
        supportingEvidenceCount: 1,
        contradictingEvidenceCount: 0,
        createdBy: "user_correction",
        changeReason: "Investor agreed with a Learning Insight.",
      })
      .returning();
    await tx.insert(evidence).values({
      dnaHypothesisId: identity!.id,
      stance: "supporting",
      sourceLearningInsightId: learningInsightId,
      description: "You agreed with this Learning Insight.",
    });

    return { hypothesis: identity!, version: version! };
  });
}

// Hypothesis Identity (Evidence Grounding + Hypothesis Identity Hardening
// task) — the first real caller of insertDnaHypothesisVersion for an
// EXISTING identity (previously dead code from dna.generate's point of
// view: every generate() call always created a brand-new identity).
// Appends exactly one new version to an existing DNAHypothesis identity,
// plus the genuinely-new Evidence rows that justified it — never touches
// the identity's earlier versions or earlier Evidence rows (both stay
// exactly as persisted; this only ever adds). versionNumber is looked up
// fresh, inside the same transaction as the insert, under a FOR UPDATE lock on
// the identity row. The caller passes the base version (and its grounding-check
// count) it COUNTED against; if either moved, StaleIdentityVersionError is
// thrown and nothing is written. The table's own UNIQUE(…, version_number)
// constraint stays as the last backstop — the caller translates either error
// to a clear, retryable one rather than treating it as unexpected.
export async function insertDnaHypothesisVersionWithEvidence(
  db: typeof Db,
  dnaHypothesisId: string,
  version: {
    /** The version this generation COUNTED against (the identity's latest when it read the evidence). */
    expectedBaseVersionId: string;
    /** How many grounding checks that version had when it was read. */
    expectedBaseCheckCount: number;
    statementText: string;
    evidenceStrength: ValidatedHypothesis["evidenceStrength"];
    supportingEvidenceCount: number;
    contradictingEvidenceCount: number;
    independenceBasis: IndependenceBasis;
    newEvidence: ValidatedHypothesis["evidence"];
    changeReason: string;
  }
) {
  return db.transaction(async (tx) => {
    // Serialize with the recalculation executors, which append under the same lock.
    await tx.select({ id: dnaHypotheses.id }).from(dnaHypotheses).where(eq(dnaHypotheses.id, dnaHypothesisId)).for("update");

    const latest = await getLatestDnaHypothesisVersion(tx, dnaHypothesisId);
    // The counts were computed from the effective evidence of THIS base
    // version, and its grounding verdicts are what gets carried forward. If
    // another writer appended a version — or added grounding checks to this
    // one — since the generation read it, the two would describe different
    // states: write nothing.
    if (!latest || latest.id !== version.expectedBaseVersionId) {
      throw new StaleIdentityVersionError(
        dnaHypothesisId,
        `counted against version ${version.expectedBaseVersionId} but the latest is ${latest?.id ?? "(none)"}`
      );
    }
    const baseChecks = await tx.select().from(dnaEvidenceGroundingChecks).where(eq(dnaEvidenceGroundingChecks.dnaHypothesisVersionId, latest.id));
    if (baseChecks.length !== version.expectedBaseCheckCount) {
      throw new StaleIdentityVersionError(
        dnaHypothesisId,
        `counted against ${version.expectedBaseCheckCount} grounding check(s) on version ${latest.id} but it now has ${baseChecks.length}`
      );
    }
    const nextVersionNumber = latest.versionNumber + 1;

    const [newVersion] = await tx
      .insert(dnaHypothesisVersions)
      .values({
        dnaHypothesisId,
        versionNumber: nextVersionNumber,
        statementText: version.statementText,
        evidenceStrength: version.evidenceStrength,
        supportingEvidenceCount: version.supportingEvidenceCount,
        contradictingEvidenceCount: version.contradictingEvidenceCount,
        independenceBasisJson: version.independenceBasis,
        createdBy: "ai_generated",
        changeReason: version.changeReason,
      })
      .returning();

    const insertedEvidence =
      version.newEvidence.length > 0
        ? await tx
            .insert(evidence)
            .values(
              version.newEvidence.map((e) => ({
                dnaHypothesisId,
                stance: e.stance,
                interviewAnswerId: e.interviewAnswerId,
                description: e.description,
              }))
            )
            .returning({ id: evidence.id })
        : [];

    // Version-scoped grounding verdicts must not be dropped by appending a
    // version: without rows here this version would fall back to "every raw
    // citation is effective" and re-admit whatever a remediation rejected.
    const checks = checksForAppendedVersion(
      latest.id,
      baseChecks,
      insertedEvidence.map((row) => row.id)
    );
    if (checks.length > 0) {
      await assertEvidenceBelongsToHypothesis(
        tx,
        dnaHypothesisId,
        checks.map((c) => c.evidenceId)
      );
      await tx.insert(dnaEvidenceGroundingChecks).values(
        checks.map((c) => ({
          dnaHypothesisVersionId: newVersion!.id,
          evidenceId: c.evidenceId,
          verdict: c.verdict,
          reason: c.reason,
        }))
      );
    }

    return { version: newVersion! };
  });
}

// Independent-audit hardening: neither UNIQUE(dna_hypothesis_version_id,
// evidence_id) nor either FK proves the two sides actually belong to the
// SAME DNAHypothesis identity — a version FK'd to hypothesis A and an
// Evidence row FK'd to hypothesis B are both individually valid rows, so
// a caller bug (or, once a real orchestration exists, a stale/mismatched
// read) could silently associate hypothesis A's version with hypothesis
// B's citation with nothing in the schema to catch it. Both insert paths
// below verify this explicitly, inside their own transaction, before
// writing — the narrowest possible fix, scoped to exactly the new table
// this task introduces.
async function assertEvidenceBelongsToHypothesis(
  tx: DbOrTx,
  dnaHypothesisId: string,
  evidenceIds: readonly string[]
): Promise<void> {
  const uniqueIds = [...new Set(evidenceIds)];
  if (uniqueIds.length === 0) return;
  const rows = await tx
    .select({ id: evidence.id })
    .from(evidence)
    .where(and(eq(evidence.dnaHypothesisId, dnaHypothesisId), inArray(evidence.id, uniqueIds)));
  if (rows.length !== uniqueIds.length) {
    throw new Error(
      `Grounding check evidence ids do not all belong to DNA hypothesis ${dnaHypothesisId} — refusing to persist a cross-identity association.`
    );
  }
}

// DNA Grounding Remediation — the "checked_no_change" outcome of
// planGroundingRemediation(): every raw citation still survives grounding
// under the current standard, so no new version is warranted, but the
// check itself is still worth persisting. Without these rows this
// version would stay indistinguishable from one that was never checked
// at all (getEffectiveEvidenceForDnaHypothesisVersion's legacy fallback
// would keep treating it as unchecked forever). No version insert here —
// the current version stays exactly as it was, only new
// dna_evidence_grounding_checks rows are appended against it.
//
// dnaHypothesisId is deliberately NOT a parameter here — it's looked up
// FROM dnaHypothesisVersionId itself (the one authoritative source),
// rather than trusting a second, independently-supplied value that could
// disagree with it.
export async function insertGroundingChecksForVersion(
  db: typeof Db,
  dnaHypothesisVersionId: string,
  checks: readonly RemediationCheckResult[]
) {
  if (checks.length === 0) return [];
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(dnaHypothesisVersions)
      .where(eq(dnaHypothesisVersions.id, dnaHypothesisVersionId));
    if (!version) {
      throw new Error(`insertGroundingChecksForVersion: DNA hypothesis version ${dnaHypothesisVersionId} not found.`);
    }
    await assertEvidenceBelongsToHypothesis(
      tx,
      version.dnaHypothesisId,
      checks.map((c) => c.evidenceId)
    );

    // onConflictDoNothing (same convention as ensureDefaultRiskPrinciples's
    // seed insert, strategy.ts): unlike insertDnaHypothesisVersionWithGroundingChecks
    // (whose version — and therefore whose check rows — is always brand
    // new inside the same transaction, so a real conflict there can only
    // mean a caller bug), THIS path appends checks to an EXISTING,
    // already-live version — a genuine concurrent race is possible if two
    // "checked_no_change" audits of the same version run at the same
    // time. Both would have computed the same verdicts from the same
    // grounding inputs; letting the loser's insert silently no-op instead
    // of raising a raw uniqueness error avoids a needless failure for a
    // race with no actual conflicting information.
    return tx
      .insert(dnaEvidenceGroundingChecks)
      .values(
        checks.map((c) => ({
          dnaHypothesisVersionId,
          evidenceId: c.evidenceId,
          verdict: c.verdict,
          reason: c.reason,
        }))
      )
      .onConflictDoNothing()
      .returning();
  });
}

// DNA Grounding Remediation — the "new_version" outcome of
// planGroundingRemediation(): the effective evidence set changed, so a
// new append-only version is warranted. Deliberately a SEPARATE function
// from insertDnaHypothesisVersionWithEvidence, not a reuse of it with
// empty newEvidence: remediation never inserts new Evidence rows (it only
// ever reinterprets citations that already exist), and it always writes
// dna_evidence_grounding_checks rows the ordinary generate() path has no
// concept of — merging the two into one function with optional
// parameters would make it unclear, at each call site, which invariant
// applies. Same transactional shape and the same UNIQUE(dna_hypothesis_id,
// version_number) backstop against a genuine concurrent-write race
// (isUniqueViolation() at the call site, identical convention).
export async function insertDnaHypothesisVersionWithGroundingChecks(
  db: typeof Db,
  dnaHypothesisId: string,
  version: RemediationNewVersion,
  checks: readonly RemediationCheckResult[]
) {
  return db.transaction(async (tx) => {
    if (checks.length > 0) {
      await assertEvidenceBelongsToHypothesis(
        tx,
        dnaHypothesisId,
        checks.map((c) => c.evidenceId)
      );
    }

    const latest = await getLatestDnaHypothesisVersion(tx, dnaHypothesisId);
    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

    const [newVersion] = await tx
      .insert(dnaHypothesisVersions)
      .values({
        dnaHypothesisId,
        versionNumber: nextVersionNumber,
        statementText: version.statementText,
        evidenceStrength: version.evidenceStrength,
        supportingEvidenceCount: version.supportingEvidenceCount,
        contradictingEvidenceCount: version.contradictingEvidenceCount,
        independenceBasisJson: version.independenceBasis,
        createdBy: "system_grounding_revalidation",
        changeReason: version.changeReason,
      })
      .returning();

    if (checks.length > 0) {
      await tx.insert(dnaEvidenceGroundingChecks).values(
        checks.map((c) => ({
          dnaHypothesisVersionId: newVersion!.id,
          evidenceId: c.evidenceId,
          verdict: c.verdict,
          reason: c.reason,
        }))
      );
    }

    return { version: newVersion! };
  });
}

// Confidence Recalculation Remediation (DNA): if this identity's LATEST
// version stores a tier the current calculateEvidenceStrength() would not
// produce from that version's own S/C, append ONE new version that
// repeats everything and differs only in the recomputed tier and
// provenance. Never an UPDATE; the old version stays untouched. No AI, no
// new Evidence rows — only version-scoped grounding checks are carried
// forward so the effective evidence set cannot change.
//
// Concurrency: the identity row is locked FOR UPDATE, so concurrent
// recalculations of one identity serialize — the loser then re-reads the
// (now corrected) latest version and no-ops. UNIQUE(dna_hypothesis_id,
// version_number) remains the backstop against a writer that does not take
// the lock (a concurrent dna.generate version append): that surfaces as
// "superseded_concurrently" — nothing written, safe to simply re-run.
export async function recalculateDnaHypothesisConfidence(
  db: typeof Db,
  dnaHypothesisId: string
): Promise<ConfidenceRecalculationOutcome<typeof dnaHypothesisVersions.$inferSelect>> {
  try {
    return await db.transaction(async (tx) => {
      await tx
        .select({ id: dnaHypotheses.id })
        .from(dnaHypotheses)
        .where(eq(dnaHypotheses.id, dnaHypothesisId))
        .for("update");

      const latest = await getLatestDnaHypothesisVersion(tx, dnaHypothesisId);
      if (!latest) throw new Error(`recalculateDnaHypothesisConfidence: DNA hypothesis ${dnaHypothesisId} has no versions.`);

      const plan = planConfidenceRecalculation(latest);
      if (plan.action === "no_op") return { action: "no_op" as const, reason: plan.reason };

      const baseChecks = await tx
        .select()
        .from(dnaEvidenceGroundingChecks)
        .where(eq(dnaEvidenceGroundingChecks.dnaHypothesisVersionId, latest.id));
      const carried = carryForwardGroundingChecks(latest.id, baseChecks);
      await assertEvidenceBelongsToHypothesis(
        tx,
        dnaHypothesisId,
        carried.map((c) => c.evidenceId)
      );

      const [version] = await tx
        .insert(dnaHypothesisVersions)
        .values({
          dnaHypothesisId,
          versionNumber: latest.versionNumber + 1,
          ...buildRecalculatedDnaVersion(latest, plan),
        })
        .returning();

      if (carried.length > 0) {
        await tx.insert(dnaEvidenceGroundingChecks).values(
          carried.map((c) => ({
            dnaHypothesisVersionId: version!.id,
            evidenceId: c.evidenceId,
            verdict: c.verdict,
            reason: c.reason,
          }))
        );
      }

      return { action: "appended" as const, plan, version: version!, carriedForwardChecks: carried.length };
    });
  } catch (err) {
    if (isUniqueViolation(err, "dna_hypothesis_versions_dna_hypothesis_id_version_number_unique")) {
      return { action: "no_op", reason: "superseded_concurrently" };
    }
    throw err;
  }
}

// Decision Independence V1 (DNA): if the resolver now counts this
// identity's LATEST version's effective evidence lower than the version
// stored, append ONE new version — same statement, same evidence, the
// resolver's counts and basis, provenance system_independence_recalculation.
// Never an UPDATE; the old version stays untouched. A confidence RISE is
// never appended here (directional guard): it comes back as
// "requires_review". Locking and concurrency are identical to
// recalculateDnaHypothesisConfidence above.
export async function recalculateDnaHypothesisIndependence(
  db: typeof Db,
  dnaHypothesisId: string,
  independence: EvidenceIndependenceResolver
): Promise<IndependenceRecalculationOutcome<typeof dnaHypothesisVersions.$inferSelect>> {
  try {
    return await db.transaction(async (tx) => {
      await tx
        .select({ id: dnaHypotheses.id })
        .from(dnaHypotheses)
        .where(eq(dnaHypotheses.id, dnaHypothesisId))
        .for("update");

      const latest = await getLatestDnaHypothesisVersion(tx, dnaHypothesisId);
      if (!latest) throw new Error(`recalculateDnaHypothesisIndependence: DNA hypothesis ${dnaHypothesisId} has no versions.`);

      const [rawEvidence, baseChecks] = await Promise.all([
        tx.select().from(evidence).where(eq(evidence.dnaHypothesisId, dnaHypothesisId)),
        tx.select().from(dnaEvidenceGroundingChecks).where(eq(dnaEvidenceGroundingChecks.dnaHypothesisVersionId, latest.id)),
      ]);
      const effective = selectEffectiveEvidence(rawEvidence, baseChecks);

      const plan = planIndependenceRecalculation(latest, citationsFromEvidence(effective), independence);
      if (plan.action === "no_op") return { action: "no_op" as const, reason: plan.reason };
      if (plan.action === "requires_review") return { action: "requires_review" as const, plan };

      const carried = carryForwardGroundingChecks(latest.id, baseChecks);
      await assertEvidenceBelongsToHypothesis(
        tx,
        dnaHypothesisId,
        carried.map((c) => c.evidenceId)
      );

      const [version] = await tx
        .insert(dnaHypothesisVersions)
        .values({
          dnaHypothesisId,
          versionNumber: latest.versionNumber + 1,
          ...buildIndependenceRecalculatedDnaVersion(latest, plan),
        })
        .returning();

      if (carried.length > 0) {
        await tx.insert(dnaEvidenceGroundingChecks).values(
          carried.map((c) => ({
            dnaHypothesisVersionId: version!.id,
            evidenceId: c.evidenceId,
            verdict: c.verdict,
            reason: c.reason,
          }))
        );
      }

      return { action: "appended" as const, plan, version: version!, carriedForwardChecks: carried.length };
    });
  } catch (err) {
    if (isUniqueViolation(err, "dna_hypothesis_versions_dna_hypothesis_id_version_number_unique")) {
      return { action: "no_op", reason: "superseded_concurrently" };
    }
    throw err;
  }
}

// The identity row's status (active|user_rejected) is a simple lifecycle
// flag, not a versioned judgment — mutable by design (docs/data-model.md
// §2: the DNAHypothesis identity row itself isn't in the immutable list,
// only DNAHypothesisVersion is).
export async function setDnaHypothesisStatus(
  db: typeof Db,
  dnaHypothesisId: string,
  status: "active" | "user_rejected"
) {
  await db.update(dnaHypotheses).set({ status }).where(eq(dnaHypotheses.id, dnaHypothesisId));
}
