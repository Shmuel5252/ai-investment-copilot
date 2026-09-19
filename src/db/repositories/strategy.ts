import { eq, desc, and, inArray } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db, DbOrTx } from "@/db/client";
import {
  strategyPrinciples,
  strategyPrincipleVersions,
  strategyVersions,
  strategyVersionPrinciples,
  strategyEvidenceGroundingChecks,
  evidence,
} from "@/db/schema";
import { DEFAULT_RISK_PRINCIPLES } from "@/lib/strategy/default-risk-principles";
import { slugifyPrincipleKey } from "@/lib/strategy/slugify";
import type { ValidatedDeclaredPrinciple, ValidatedObservedPrinciple, ValidatedPrincipleEvidence } from "@/lib/strategy/validate-principles";
import type { RemediationCheckResult, RemediationNewPrincipleVersion } from "@/lib/strategy/remediate-grounding";
import { isUniqueViolation } from "@/db/errors";
import {
  planConfidenceRecalculation,
  buildRecalculatedStrategyVersion,
  carryForwardGroundingChecks,
  type ConfidenceRecalculationOutcome,
} from "@/lib/evidence/recalculate-confidence";

export type NewStrategyPrinciple = InferInsertModel<typeof strategyPrinciples>;
export type NewStrategyPrincipleVersion = InferInsertModel<typeof strategyPrincipleVersions>;
export type NewStrategyVersion = InferInsertModel<typeof strategyVersions>;

export async function insertStrategyPrinciple(db: typeof Db, values: NewStrategyPrinciple) {
  const [row] = await db.insert(strategyPrinciples).values(values).returning();
  return row!;
}

// Append-only.
export async function insertStrategyPrincipleVersion(
  db: typeof Db,
  values: NewStrategyPrincipleVersion
) {
  const [row] = await db.insert(strategyPrincipleVersions).values(values).returning();
  return row!;
}

// Bundles a new whole-strategy version together with the set of
// principle-versions active in it (new + carried-over unchanged ones) —
// see docs/data-model.md §0 "Whole-bundle Version". Append-only.
export async function insertStrategyVersion(
  db: typeof Db,
  values: NewStrategyVersion,
  principleVersionIds: string[]
) {
  return db.transaction(async (tx) => {
    const [version] = await tx.insert(strategyVersions).values(values).returning();
    if (principleVersionIds.length > 0) {
      await tx.insert(strategyVersionPrinciples).values(
        principleVersionIds.map((strategyPrincipleVersionId) => ({
          strategyVersionId: version!.id,
          strategyPrincipleVersionId,
        }))
      );
    }
    return version!;
  });
}

export async function getLatestStrategyVersion(db: typeof Db, investorId: string) {
  const [row] = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.investorId, investorId))
    .orderBy(desc(strategyVersions.versionNumber))
    .limit(1);
  return row;
}

// DbOrTx (not typeof Db) so the version-writing functions below can
// read-then-insert inside one outer transaction — same reasoning as
// getLatestDnaHypothesisVersion (src/db/repositories/dna.ts).
export async function getLatestStrategyPrincipleVersion(
  db: DbOrTx,
  strategyPrincipleId: string
) {
  const [row] = await db
    .select()
    .from(strategyPrincipleVersions)
    .where(eq(strategyPrincipleVersions.strategyPrincipleId, strategyPrincipleId))
    .orderBy(desc(strategyPrincipleVersions.versionNumber))
    .limit(1);
  return row;
}

// The full set of principle-versions bundled into a given whole-strategy
// version — "what did the Strategy actually say at that point in time".
export async function getStrategyVersionPrinciples(db: typeof Db, strategyVersionId: string) {
  return db.query.strategyVersionPrinciples.findMany({
    where: (svp, { eq }) => eq(svp.strategyVersionId, strategyVersionId),
    with: { principleVersion: true },
  });
}

// All of an investor's principles (declared + observed + validated),
// each with its latest version only — "current version" = MAX(version_number)
// per principle, same rule as everywhere else in this codebase
// (docs/data-model.md §0). Mirrors listActiveDnaHypothesesForInvestor,
// minus a status filter: strategyPrinciples has no status column (see
// docs/architecture.md §2.4 — Correction, not a reject flag, is the
// disagreement mechanism for Strategy, and wiring that up is out of
// scope for this task).
export async function listStrategyPrinciplesForInvestor(db: typeof Db, investorId: string) {
  return db.query.strategyPrinciples.findMany({
    where: (p, { eq }) => eq(p.investorId, investorId),
    with: {
      versions: { orderBy: (v, { desc }) => desc(v.versionNumber), limit: 1 },
    },
    orderBy: (p, { asc }) => asc(p.createdAt),
  });
}

// Fixed baseline risk principles (docs/architecture.md §2.4) — code
// only, no AI, no user approval needed since these aren't a claim about
// this investor. Idempotent by `key`, enforced by the DB's own unique
// (investor_id, key) constraint via onConflictDoNothing — not an
// application-level "check existing, then insert" pre-check. A real bug
// caught live: that pre-check pattern is a TOCTOU race (two
// near-simultaneous calls — e.g. React StrictMode's intentional
// double-invoke of a mount effect in dev — can both see "nothing exists
// yet" before either commits, and both insert), which is exactly what
// happened and produced real duplicate rows on a real account. The
// unique constraint is what actually makes this safe; onConflictDoNothing
// just lets a real conflict resolve to "already there" instead of an
// error.
export async function ensureDefaultRiskPrinciples(db: typeof Db, investorId: string) {
  const created = [];
  for (const def of DEFAULT_RISK_PRINCIPLES) {
    const result = await db.transaction(async (tx) => {
      const [principle] = await tx
        .insert(strategyPrinciples)
        .values({ investorId, key: def.key })
        .onConflictDoNothing({ target: [strategyPrinciples.investorId, strategyPrinciples.key] })
        .returning();
      if (!principle) return null; // real conflict at the DB — this default already exists
      const [version] = await tx
        .insert(strategyPrincipleVersions)
        .values({
          strategyPrincipleId: principle.id,
          versionNumber: 1,
          principleType: "validated",
          statementText: def.statementText,
          rationaleText: def.rationaleText,
          createdBy: "system_default",
        })
        .returning();
      return { principle, version: version! };
    });
    if (result) created.push(result);
  }
  return created;
}

// Declared principle — the investor's own stated rule, transcribed by AI
// and confirmed by the user before anything is written (docs/architecture.md
// §2.4: "AI מחלץ, משתמש מאשר" — unlike Observed/DNA, approval gates
// creation itself, not just post-hoc rejection). The citing answer(s)
// become supporting Evidence, same mechanism as everywhere else, giving
// even a verbatim declaration real Traceability rather than just trusting
// the transcription.
export async function insertDeclaredPrinciple(
  db: typeof Db,
  investorId: string,
  principle: ValidatedDeclaredPrinciple
) {
  return db.transaction(async (tx) => {
    const [identity] = await tx
      .insert(strategyPrinciples)
      .values({ investorId, key: slugifyPrincipleKey(principle.statementText) })
      .returning();
    const [version] = await tx
      .insert(strategyPrincipleVersions)
      .values({
        strategyPrincipleId: identity!.id,
        versionNumber: 1,
        principleType: "declared",
        statementText: principle.statementText,
        rationaleText: principle.rationaleText,
        createdBy: "user_declared",
      })
      .returning();

    await tx.insert(evidence).values(
      principle.citedAnswerIds.map((interviewAnswerId) => ({
        strategyPrincipleId: identity!.id,
        stance: "supporting" as const,
        interviewAnswerId,
        description: "You stated this directly in the onboarding interview.",
      }))
    );

    return { principle: identity!, version: version! };
  });
}

// Observed principle — "same Evidence engine as DNA" (docs/architecture.md
// §2.4): written immediately with evidenceStrength always computed in
// code from the *validated* counts (never trusted from the AI), mirroring
// insertDnaHypothesisWithEvidence exactly. Called only with output from
// validateProposedObservedPrinciples().
export async function insertObservedPrincipleWithEvidence(
  db: typeof Db,
  investorId: string,
  principle: ValidatedObservedPrinciple
) {
  return db.transaction(async (tx) => {
    const [identity] = await tx
      .insert(strategyPrinciples)
      .values({ investorId, key: slugifyPrincipleKey(principle.statement) })
      .returning();
    const [version] = await tx
      .insert(strategyPrincipleVersions)
      .values({
        strategyPrincipleId: identity!.id,
        versionNumber: 1,
        principleType: "observed",
        statementText: principle.statement,
        rationaleText: "Observed as a pattern across your interview answers, not stated directly.",
        createdBy: "ai_observed",
        evidenceStrength: principle.evidenceStrength,
        supportingEvidenceCount: principle.supportingCount,
        contradictingEvidenceCount: principle.contradictingCount,
      })
      .returning();

    await tx.insert(evidence).values(
      principle.evidence.map((e) => ({
        strategyPrincipleId: identity!.id,
        stance: e.stance,
        interviewAnswerId: e.interviewAnswerId,
        description: e.description,
      }))
    );

    return { principle: identity!, version: version! };
  });
}

// Hypothesis/Identity Hardening for Strategy — the first real caller of
// insertStrategyPrincipleVersion for an EXISTING identity (previously
// dead code from generateObserved's point of view: every call always
// created a brand-new identity). Appends exactly one new version to an
// existing OBSERVED strategyPrinciples identity, plus the genuinely-new
// Evidence rows that justified it — mirrors
// insertDnaHypothesisVersionWithEvidence exactly, including relying on
// the table's own UNIQUE(strategy_principle_id, version_number)
// constraint as the concurrency backstop (caller catches
// isUniqueViolation()). principleType is always "observed" here — this
// path only exists for the observed-identity-matching flow.
export async function insertObservedPrincipleVersionWithEvidence(
  db: typeof Db,
  strategyPrincipleId: string,
  version: {
    statementText: string;
    evidenceStrength: ValidatedObservedPrinciple["evidenceStrength"];
    supportingEvidenceCount: number;
    contradictingEvidenceCount: number;
    newEvidence: ValidatedPrincipleEvidence[];
    changeReason: string;
  }
) {
  return db.transaction(async (tx) => {
    const latest = await getLatestStrategyPrincipleVersion(tx, strategyPrincipleId);
    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

    const [newVersion] = await tx
      .insert(strategyPrincipleVersions)
      .values({
        strategyPrincipleId,
        versionNumber: nextVersionNumber,
        principleType: "observed",
        statementText: version.statementText,
        rationaleText: "Observed as a pattern across your interview answers, not stated directly.",
        evidenceStrength: version.evidenceStrength,
        supportingEvidenceCount: version.supportingEvidenceCount,
        contradictingEvidenceCount: version.contradictingEvidenceCount,
        createdBy: "ai_observed",
        changeReason: version.changeReason,
      })
      .returning();

    if (version.newEvidence.length > 0) {
      await tx.insert(evidence).values(
        version.newEvidence.map((e) => ({
          strategyPrincipleId,
          stance: e.stance,
          interviewAnswerId: e.interviewAnswerId,
          description: e.description,
        }))
      );
    }

    return { version: newVersion! };
  });
}

// Independent-audit hardening, applied proactively this time (learned
// from the DNA equivalent's own independent review, src/db/repositories/dna.ts):
// neither UNIQUE(strategy_principle_version_id, evidence_id) nor either
// FK proves the two sides belong to the SAME strategyPrinciples identity
// — a version FK'd to principle A and an Evidence row FK'd to principle B
// are each individually valid rows. Both grounding-check insert paths
// below verify this explicitly, inside their own transaction, before
// writing.
async function assertEvidenceBelongsToPrinciple(
  tx: DbOrTx,
  strategyPrincipleId: string,
  evidenceIds: readonly string[]
): Promise<void> {
  const uniqueIds = [...new Set(evidenceIds)];
  if (uniqueIds.length === 0) return;
  const rows = await tx
    .select({ id: evidence.id })
    .from(evidence)
    .where(and(eq(evidence.strategyPrincipleId, strategyPrincipleId), inArray(evidence.id, uniqueIds)));
  if (rows.length !== uniqueIds.length) {
    throw new Error(
      `Grounding check evidence ids do not all belong to Strategy principle ${strategyPrincipleId} — refusing to persist a cross-identity association.`
    );
  }
}

// DNA Grounding Remediation's Strategy mirror — the "checked_no_change"
// outcome of planPrincipleGroundingRemediation(): every raw citation
// still survives grounding under the current standard, so no new version
// is warranted, but the check itself is still worth persisting (without
// it this version would stay indistinguishable from one that was never
// checked at all). No version insert here.
//
// strategyPrincipleId is deliberately NOT a parameter — it's looked up
// FROM strategyPrincipleVersionId itself (the one authoritative source),
// rather than trusting a second, independently-supplied value that could
// disagree with it.
export async function insertGroundingChecksForPrincipleVersion(
  db: typeof Db,
  strategyPrincipleVersionId: string,
  checks: readonly RemediationCheckResult[]
) {
  if (checks.length === 0) return [];
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(strategyPrincipleVersions)
      .where(eq(strategyPrincipleVersions.id, strategyPrincipleVersionId));
    if (!version) {
      throw new Error(`insertGroundingChecksForPrincipleVersion: Strategy principle version ${strategyPrincipleVersionId} not found.`);
    }
    await assertEvidenceBelongsToPrinciple(
      tx,
      version.strategyPrincipleId,
      checks.map((c) => c.evidenceId)
    );

    // onConflictDoNothing (same convention as ensureDefaultRiskPrinciples's
    // seed insert, and its DNA mirror insertGroundingChecksForVersion): a
    // genuine concurrent race between two "checked_no_change" audits of
    // the same version would have computed the same verdicts from the
    // same inputs — let the loser's insert silently no-op rather than
    // raise a raw uniqueness error.
    return tx
      .insert(strategyEvidenceGroundingChecks)
      .values(
        checks.map((c) => ({
          strategyPrincipleVersionId,
          evidenceId: c.evidenceId,
          verdict: c.verdict,
          reason: c.reason,
        }))
      )
      .onConflictDoNothing()
      .returning();
  });
}

// DNA Grounding Remediation's Strategy mirror — the "new_version" outcome
// of planPrincipleGroundingRemediation(): the effective evidence set
// changed, so a new append-only version is warranted. Deliberately a
// SEPARATE function from insertObservedPrincipleVersionWithEvidence:
// remediation never inserts new Evidence rows (it only ever reinterprets
// citations that already exist), and it always writes
// strategy_evidence_grounding_checks rows the ordinary generateObserved
// path has no concept of.
export async function insertObservedPrincipleVersionWithGroundingChecks(
  db: typeof Db,
  strategyPrincipleId: string,
  version: RemediationNewPrincipleVersion,
  checks: readonly RemediationCheckResult[]
) {
  return db.transaction(async (tx) => {
    if (checks.length > 0) {
      await assertEvidenceBelongsToPrinciple(
        tx,
        strategyPrincipleId,
        checks.map((c) => c.evidenceId)
      );
    }

    const latest = await getLatestStrategyPrincipleVersion(tx, strategyPrincipleId);
    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

    const [newVersion] = await tx
      .insert(strategyPrincipleVersions)
      .values({
        strategyPrincipleId,
        versionNumber: nextVersionNumber,
        principleType: version.principleType,
        statementText: version.statementText,
        rationaleText: "Observed as a pattern across your interview answers, not stated directly.",
        evidenceStrength: version.evidenceStrength,
        supportingEvidenceCount: version.supportingEvidenceCount,
        contradictingEvidenceCount: version.contradictingEvidenceCount,
        createdBy: "system_grounding_revalidation",
        changeReason: version.changeReason,
      })
      .returning();

    if (checks.length > 0) {
      await tx.insert(strategyEvidenceGroundingChecks).values(
        checks.map((c) => ({
          strategyPrincipleVersionId: newVersion!.id,
          evidenceId: c.evidenceId,
          verdict: c.verdict,
          reason: c.reason,
        }))
      );
    }

    return { version: newVersion! };
  });
}

// Confidence Recalculation Remediation (Strategy) — the mirror of
// recalculateDnaHypothesisConfidence (see that comment for the full
// reasoning). If this principle's LATEST version stores a tier the current
// calculateEvidenceStrength() would not produce from its own S/C, append
// ONE new version that repeats identity, statement, principleType and
// rationale and differs only in the recomputed tier and provenance. Never
// an UPDATE, no AI, no new Evidence; declared/validated principles carry
// no tier and are a no-op. The Strategy BUNDLE tables are not touched — a
// whole-Strategy version only ever moves on explicit user approval.
export async function recalculatePrincipleConfidence(
  db: typeof Db,
  strategyPrincipleId: string
): Promise<ConfidenceRecalculationOutcome<typeof strategyPrincipleVersions.$inferSelect>> {
  try {
    return await db.transaction(async (tx) => {
      await tx
        .select({ id: strategyPrinciples.id })
        .from(strategyPrinciples)
        .where(eq(strategyPrinciples.id, strategyPrincipleId))
        .for("update");

      const latest = await getLatestStrategyPrincipleVersion(tx, strategyPrincipleId);
      if (!latest) throw new Error(`recalculatePrincipleConfidence: Strategy principle ${strategyPrincipleId} has no versions.`);

      const plan = planConfidenceRecalculation(latest);
      if (plan.action === "no_op") return { action: "no_op" as const, reason: plan.reason };

      const baseChecks = await tx
        .select()
        .from(strategyEvidenceGroundingChecks)
        .where(eq(strategyEvidenceGroundingChecks.strategyPrincipleVersionId, latest.id));
      const carried = carryForwardGroundingChecks(latest.id, baseChecks);
      await assertEvidenceBelongsToPrinciple(
        tx,
        strategyPrincipleId,
        carried.map((c) => c.evidenceId)
      );

      const [version] = await tx
        .insert(strategyPrincipleVersions)
        .values({
          strategyPrincipleId,
          versionNumber: latest.versionNumber + 1,
          ...buildRecalculatedStrategyVersion(latest, plan),
        })
        .returning();

      if (carried.length > 0) {
        await tx.insert(strategyEvidenceGroundingChecks).values(
          carried.map((c) => ({
            strategyPrincipleVersionId: version!.id,
            evidenceId: c.evidenceId,
            verdict: c.verdict,
            reason: c.reason,
          }))
        );
      }

      return { action: "appended" as const, plan, version: version!, carriedForwardChecks: carried.length };
    });
  } catch (err) {
    if (isUniqueViolation(err, "strategy_principle_versions_strategy_principle_id_version_numbe")) {
      return { action: "no_op", reason: "superseded_concurrently" };
    }
    throw err;
  }
}

// "User approves a change -> new [whole-Strategy] version"
// (docs/architecture.md §2.4). Bundles the *current* latest version of
// every one of the investor's principles (declared + observed + validated
// alike, including carried-over ones nothing changed about) into one new
// StrategyVersion — docs/data-model.md §0 "Whole-bundle Version".
export async function approveStrategyVersion(
  db: typeof Db,
  investorId: string,
  changeSummary: string
) {
  const principles = await listStrategyPrinciplesForInvestor(db, investorId);
  const principleVersionIds = principles
    .map((p) => p.versions[0]?.id)
    .filter((id): id is string => !!id);

  const latest = await getLatestStrategyVersion(db, investorId);
  const versionNumber = (latest?.versionNumber ?? 0) + 1;

  return insertStrategyVersion(db, { investorId, versionNumber, changeSummary }, principleVersionIds);
}
