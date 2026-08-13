import { eq } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import {
  theses,
  decisions,
  decisionSnapshots,
  decisionSnapshotDnaReferences,
  laterContexts,
  decisionReviews,
  reviewDimensions,
  predictions,
} from "@/db/schema";

export type NewThesis = InferInsertModel<typeof theses>;
export type NewDecision = InferInsertModel<typeof decisions>;
export type NewDecisionSnapshot = InferInsertModel<typeof decisionSnapshots>;
export type NewLaterContext = InferInsertModel<typeof laterContexts>;
export type NewDecisionReview = InferInsertModel<typeof decisionReviews>;
export type NewReviewDimension = InferInsertModel<typeof reviewDimensions>;
export type NewPrediction = InferInsertModel<typeof predictions>;

export async function insertThesis(db: typeof Db, values: NewThesis) {
  const [row] = await db.insert(theses).values(values).returning();
  return row!;
}

export async function insertDecision(db: typeof Db, values: NewDecision) {
  const [row] = await db.insert(decisions).values(values).returning();
  return row!;
}

// The single write path for freezing a Decision Snapshot — this is the
// one insert in the whole schema that most needs to be atomic and
// complete, since nothing about it can ever be corrected after the fact
// (docs/data-model.md §5, §10). Bundles the snapshot row with its DNA
// version references in one transaction.
export async function insertDecisionSnapshot(
  db: typeof Db,
  values: NewDecisionSnapshot,
  dnaHypothesisVersionIds: string[]
) {
  return db.transaction(async (tx) => {
    const [snapshot] = await tx.insert(decisionSnapshots).values(values).returning();
    if (dnaHypothesisVersionIds.length > 0) {
      await tx.insert(decisionSnapshotDnaReferences).values(
        dnaHypothesisVersionIds.map((dnaHypothesisVersionId) => ({
          decisionSnapshotId: snapshot!.id,
          dnaHypothesisVersionId,
        }))
      );
    }
    return snapshot!;
  });
}

export async function getDecisionSnapshotByDecisionId(db: typeof Db, decisionId: string) {
  return db.query.decisionSnapshots.findFirst({
    where: (s, { eq }) => eq(s.decisionId, decisionId),
    with: { thesis: true, dnaReferences: { with: { dnaHypothesisVersion: true } } },
  });
}

// Append-only addition to a Decision after the fact — never edits the
// original DecisionSnapshot (Historical Integrity, CLAUDE.md).
export async function insertLaterContext(db: typeof Db, values: NewLaterContext) {
  const [row] = await db.insert(laterContexts).values(values).returning();
  return row!;
}

// Bundles a DecisionReview with its 7 ReviewDimension rows in one
// transaction — a review without its dimensions (or vice versa) would be
// a half-written judgment, which is worse than no judgment at all.
export async function insertDecisionReview(
  db: typeof Db,
  reviewValues: NewDecisionReview,
  dimensionValues: Omit<NewReviewDimension, "decisionReviewId">[]
) {
  return db.transaction(async (tx) => {
    const [review] = await tx.insert(decisionReviews).values(reviewValues).returning();
    await tx.insert(reviewDimensions).values(
      dimensionValues.map((d) => ({ ...d, decisionReviewId: review!.id }))
    );
    return review!;
  });
}

export async function getDecisionReviewsForDecision(db: typeof Db, decisionId: string) {
  return db.query.decisionReviews.findMany({
    where: (r, { eq }) => eq(r.decisionId, decisionId),
    orderBy: (r, { desc }) => desc(r.reviewDate),
    with: { dimensions: true },
  });
}

export async function insertPrediction(db: typeof Db, values: NewPrediction) {
  const [row] = await db.insert(predictions).values(values).returning();
  return row!;
}

// The one narrow, explicitly-named exception to "predictions are
// write-once": a Prediction's claim is set at creation and never
// changes, but its resolution fields are filled in exactly once, by the
// DecisionReview that resolves it (docs/data-model.md §5). This is not a
// general-purpose update — it only ever moves a prediction from
// "pending" to a resolved state.
export async function resolvePrediction(
  db: typeof Db,
  predictionId: string,
  resolution: {
    status: "confirmed" | "refuted" | "inconclusive";
    resolvedByReviewId: string;
    resolutionNote: string;
  }
) {
  const existing = await db.query.predictions.findFirst({
    where: (p, { eq }) => eq(p.id, predictionId),
  });
  if (!existing) throw new Error(`Prediction ${predictionId} not found`);
  if (existing.status !== "pending") {
    throw new Error(`Prediction ${predictionId} was already resolved (status=${existing.status})`);
  }

  await db
    .update(predictions)
    .set({
      status: resolution.status,
      resolvedAt: new Date(),
      resolvedByReviewId: resolution.resolvedByReviewId,
      resolutionNote: resolution.resolutionNote,
    })
    .where(eq(predictions.id, predictionId));
}
