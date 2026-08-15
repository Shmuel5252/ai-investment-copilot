import { eq, desc } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { learningInsights, learningInsightVersions, evidence } from "@/db/schema";
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

// Writes a brand-new insight (identity + first version) together with
// its already-validated Evidence rows, atomically — mirrors
// insertDnaHypothesisWithEvidence exactly. Called only with output from
// validateLearningInsightEvidence(); evidenceStrength and the
// supporting/contradicting counts are read from that validation result,
// never recomputed or trusted from raw AI output here.
export async function insertLearningInsightWithEvidence(
  db: typeof Db,
  investorId: string,
  family: string,
  insight: ValidatedLearningInsight,
  patterns: {
    decisionQualityPattern: Record<DecisionQuality, number>;
    thesisAccuracyPattern: Record<ThesisAccuracy, number>;
  }
) {
  return db.transaction(async (tx) => {
    const [identity] = await tx.insert(learningInsights).values({ investorId, family }).returning();
    const [version] = await tx
      .insert(learningInsightVersions)
      .values({
        learningInsightId: identity!.id,
        versionNumber: 1,
        statementText: insight.statementText,
        decisionQualityPatternJson: patterns.decisionQualityPattern,
        thesisAccuracyPatternJson: patterns.thesisAccuracyPattern,
        evidenceStrength: insight.evidenceStrength,
        createdBy: "ai_generated",
      })
      .returning();

    await tx.insert(evidence).values(
      insight.evidence.map((e) => ({
        learningInsightId: identity!.id,
        stance: e.stance,
        decisionReviewId: e.decisionReviewId,
        description: e.description,
      }))
    );

    return { insight: identity!, version: version! };
  });
}
