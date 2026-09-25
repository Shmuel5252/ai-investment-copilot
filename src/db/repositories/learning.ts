import { eq, desc, and, asc, inArray, sql } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { learningInsights, learningInsightVersions, evidence, decisionReviews, decisions } from "@/db/schema";
import type { ArtifactProvenance } from "@/lib/evidence/provenance";
import { fingerprintEntriesOf, fingerprintOfVersion, learningEvidenceFingerprint } from "@/lib/learning/evidence-fingerprint";
import type { ValidatedLearningInsight } from "@/lib/learning/validate-insight-evidence";
import type { DecisionQuality } from "@/lib/review/decision-quality";
import type { ThesisAccuracy } from "@/lib/learning/pattern-aggregation";

export type NewLearningInsight = InferInsertModel<typeof learningInsights>;
export type NewLearningInsightVersion = InferInsertModel<typeof learningInsightVersions>;

export async function insertLearningInsight(db: typeof Db, values: NewLearningInsight) {
  const [row] = await db.insert(learningInsights).values(values).returning();
  return row!;
}

// Append-only.
export async function insertLearningInsightVersion(
  db: typeof Db,
  values: NewLearningInsightVersion
) {
  const [row] = await db.insert(learningInsightVersions).values(values).returning();
  return row!;
}

export async function getLatestLearningInsightVersion(db: typeof Db, learningInsightId: string) {
  const [row] = await db
    .select()
    .from(learningInsightVersions)
    .where(eq(learningInsightVersions.learningInsightId, learningInsightId))
    .orderBy(desc(learningInsightVersions.versionNumber))
    .limit(1);
  return row;
}

export async function getLearningInsight(db: typeof Db, id: string) {
  return db.query.learningInsights.findFirst({ where: (li, { eq }) => eq(li.id, id) });
}

// No `status` column on the identity row (unlike DNAHypothesis) — every
// insight ever generated stays listed; the "response" side of "רואה
// תובנה... מסכים/חולק" is the Correction filed via agree/disagree
// (src/server/routers/learning.ts), not a hide/reject flag here.
export async function listLearningInsightsForInvestor(db: typeof Db, investorId: string) {
  return db.query.learningInsights.findMany({
    where: (li, { eq }) => eq(li.investorId, investorId),
    with: {
      versions: { orderBy: (v, { desc }) => desc(v.versionNumber), limit: 1 },
    },
    orderBy: (li, { desc }) => desc(li.createdAt),
  });
}

export interface LearningPatterns {
  decisionQualityPattern: Record<DecisionQuality, number>;
  thesisAccuracyPattern: Record<ThesisAccuracy, number>;
}

export type LearningInsightWriteOutcome =
  | { action: "created"; insight: typeof learningInsights.$inferSelect; version: typeof learningInsightVersions.$inferSelect; evidenceFingerprint: string }
  | {
      action: "versioned";
      insight: typeof learningInsights.$inferSelect;
      version: typeof learningInsightVersions.$inferSelect;
      evidenceFingerprint: string;
      previousFingerprint: string;
      /** Decisions the new state cites that the previous state did not (informational; the fingerprint is the authority). */
      newDecisionIds: string[];
    }
  | {
      action: "unchanged";
      insight: typeof learningInsights.$inferSelect;
      version: typeof learningInsightVersions.$inferSelect;
      evidenceFingerprint: string;
      /** true = the AI re-worded the family's pattern over the SAME effective evidence state; nothing is written, and this is reported, not hidden. */
      wordingDiffers: boolean;
      proposedStatementText: string;
    };

// Evidence Reach V1 (Unit 5; OD-R1 frozen 2026-09-25) — the ONE write path
// of learning.generate. Identity = (investor, family): ONE effective
// synthesis stream per family in V1 (multiple independent insights per
// family are deferred to a Learning V2 taxonomy). Versions are append-only
// and a version is appended ONLY when the effective evidence-state
// fingerprint changes (src/lib/learning/evidence-fingerprint.ts): a newly
// cited decision, a decision no longer cited, a stance flip, a review
// replacement — never a re-wording over the same state, which is reported
// as unchanged/wordingDiffers and neither written nor overwritten. Evidence
// rows stay per identity, append-only, deduped by (review, stance); each
// version's provenance records the entries and fingerprint that justified
// it. Deterministic, no AI in the comparison; an advisory lock per investor
// serializes concurrent runs. No unique index: synthetic duplicates already
// exist in real data and history is never rewritten — the latest identity
// of a family is the canonical one.
export async function upsertLearningInsightForFamily(
  db: typeof Db,
  investorId: string,
  family: string,
  insight: ValidatedLearningInsight,
  patterns: LearningPatterns,
  /** decisionReviewId -> decisionId for every review the family offered (the independent case key). */
  reviewDecisionIds: ReadonlyMap<string, string>,
  provenance: ArtifactProvenance | null = null
): Promise<LearningInsightWriteOutcome> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"learning.generate:" + investorId}))`);

    const [identity] = await tx
      .select()
      .from(learningInsights)
      .where(and(eq(learningInsights.investorId, investorId), eq(learningInsights.family, family)))
      .orderBy(desc(learningInsights.createdAt), desc(learningInsights.id))
      .limit(1);

    // The version records WHICH reviews it cited, for which decision (the case
    // key) and with which stance, plus the fingerprint of that state: the
    // stance authority for the OD-3 carry and the OD-R1 versioning authority
    // (evidence rows are per identity and accumulate across versions, so they
    // cannot say what THIS version was based on).
    const entries = fingerprintEntriesOf(insight.evidence, reviewDecisionIds);
    const evidenceFingerprint = learningEvidenceFingerprint(entries);
    const citedReviews = insight.evidence.map((e) => ({ decisionReviewId: e.decisionReviewId, decisionId: reviewDecisionIds.get(e.decisionReviewId), stance: e.stance }));
    const versionValues = (learningInsightId: string, versionNumber: number, changeReason: string | null) => ({
      learningInsightId,
      versionNumber,
      statementText: insight.statementText,
      decisionQualityPatternJson: patterns.decisionQualityPattern,
      thesisAccuracyPatternJson: patterns.thesisAccuracyPattern,
      evidenceStrength: insight.evidenceStrength,
      createdBy: "ai_generated" as const,
      changeReason,
      provenanceJson: { ...(provenance ?? {}), citedReviews, evidenceFingerprint },
    });
    const evidenceValues = (learningInsightId: string, rows: ValidatedLearningInsight["evidence"]) =>
      rows.map((e) => ({ learningInsightId, stance: e.stance, decisionReviewId: e.decisionReviewId, description: e.description }));

    if (!identity) {
      const [created] = await tx.insert(learningInsights).values({ investorId, family }).returning();
      const [version] = await tx.insert(learningInsightVersions).values(versionValues(created!.id, 1, null)).returning();
      await tx.insert(evidence).values(evidenceValues(created!.id, insight.evidence));
      return { action: "created", insight: created!, version: version!, evidenceFingerprint };
    }

    const [latest] = await tx
      .select()
      .from(learningInsightVersions)
      .where(eq(learningInsightVersions.learningInsightId, identity.id))
      .orderBy(desc(learningInsightVersions.versionNumber))
      .limit(1);
    const existingRows = await tx
      .select({ decisionReviewId: evidence.decisionReviewId, stance: evidence.stance, decisionId: decisionReviews.decisionId })
      .from(evidence)
      .innerJoin(decisionReviews, eq(decisionReviews.id, evidence.decisionReviewId))
      .where(eq(evidence.learningInsightId, identity.id));
    const citedPairs = new Set(existingRows.map((r) => `${r.decisionReviewId}::${r.stance}`));
    // The state the LATEST version was justified by — its own provenance, or
    // (legacy NULL provenance) the identity's accumulated rows, a one-time
    // re-baseline that can only ever append a version, never rewrite one.
    const previous = fingerprintOfVersion(latest?.provenanceJson ?? null, existingRows.filter((r) => r.decisionReviewId !== null).map((r) => ({ decisionId: r.decisionId, decisionReviewId: r.decisionReviewId!, stance: r.stance })));
    if (!latest || previous.fingerprint === evidenceFingerprint) {
      return { action: "unchanged", insight: identity, version: latest!, evidenceFingerprint, wordingDiffers: latest !== undefined && latest.statementText !== insight.statementText, proposedStatementText: insight.statementText };
    }
    const previousDecisionIds = new Set(previous.fingerprint.slice(previous.fingerprint.indexOf(":") + 1).split(";").map((k) => k.split("|")[0]!));
    const newDecisionIds = [...new Set(entries.map((e) => e.decisionId))].filter((d) => !previousDecisionIds.has(d)).sort();

    const [version] = await tx
      .insert(learningInsightVersions)
      .values(versionValues(identity.id, latest.versionNumber + 1, `Effective evidence state changed (${previous.source === "legacy_rows" ? "re-baselined from legacy rows; " : ""}${newDecisionIds.length} newly cited decision(s)); statement re-synthesised over the new state.`))
      .returning();
    // Append-only history of citations: a (review, stance) pair never persisted before is recorded — including a stance the new wording flips.
    const newRows = insight.evidence.filter((e) => !citedPairs.has(`${e.decisionReviewId}::${e.stance}`));
    if (newRows.length > 0) await tx.insert(evidence).values(evidenceValues(identity.id, newRows));
    return { action: "versioned", insight: identity, version: version!, evidenceFingerprint, previousFingerprint: previous.fingerprint, newDecisionIds };
  });
}

/** decisionReviewId -> decisionId for the given review ids; a review of another investor's decision simply does not resolve. */
export async function mapReviewIdsToDecisionIds(db: typeof Db, investorId: string, reviewIds: readonly string[]): Promise<Map<string, string>> {
  if (reviewIds.length === 0) return new Map();
  const rows = await db
    .select({ reviewId: decisionReviews.id, decisionId: decisionReviews.decisionId })
    .from(decisionReviews)
    .innerJoin(decisions, eq(decisions.id, decisionReviews.decisionId))
    .where(and(eq(decisions.investorId, investorId), inArray(decisionReviews.id, [...reviewIds])))
    .orderBy(asc(decisionReviews.id));
  return new Map(rows.map((r) => [r.reviewId, r.decisionId]));
}
