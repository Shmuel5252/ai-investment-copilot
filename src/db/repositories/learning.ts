import { eq, desc } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { learningInsights, learningInsightVersions } from "@/db/schema";

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
