import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  PredictionAlreadyResolvedError,
  PredictionNotFoundError,
  PredictionNotReentryConditionError,
  ReviewDecisionNotFoundError,
  ReviewIdempotencyConflictError,
  ReviewStateChangedError,
  isUniqueViolation,
} from "@/db/errors";
import { computeReviewInputStateFingerprint } from "@/lib/review/review-fingerprint";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db, DbOrTx } from "@/db/client";
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

export async function insertThesis(db: DbOrTx, values: NewThesis) {
  const [row] = await db.insert(theses).values(values).returning();
  return row!;
}

export async function insertDecision(db: DbOrTx, values: NewDecision) {
  const [row] = await db.insert(decisions).values(values).returning();
  return row!;
}

export async function getDecision(db: typeof Db, id: string) {
  return db.query.decisions.findFirst({ where: (d, { eq }) => eq(d.id, id) });
}

export async function listDecisionsForInvestor(db: typeof Db, investorId: string) {
  return db.query.decisions.findMany({
    where: (d, { eq }) => eq(d.investorId, investorId),
    orderBy: (d, { desc }) => desc(d.decisionDate),
  });
}

// All of an investor's decisions that have at least one DecisionReview,
// each with its most recent review only — feeds Learning Insight's
// grouping (src/lib/learning/group-decisions.ts). Using the latest
// review per decision (not every historical review) avoids the same
// decision contributing multiple, possibly-stale evidence entries to a
// family.
export async function listReviewedDecisionsForInvestor(db: typeof Db, investorId: string) {
  const rows = await db.query.decisions.findMany({
    where: (d, { eq }) => eq(d.investorId, investorId),
    with: {
      snapshot: true,
      reviews: { orderBy: (r, { desc }) => desc(r.reviewDate), limit: 1 },
    },
  });
  return rows.filter((d) => d.reviews.length > 0 && d.snapshot);
}

// A Case moves to status=decided after its one Decision is recorded
// (Slice 1 simplification — see src/server/routers/decisions.ts) so
// there's at most one decision per case; this is how the case page finds
// it again after a reload.
export async function getDecisionByCaseId(db: typeof Db, investmentCaseId: string) {
  return db.query.decisions.findFirst({
    where: (d, { eq }) => eq(d.investmentCaseId, investmentCaseId),
  });
}

// Open-Decision Monitoring V1 — the legacy write-once review horizon. The
// DB predicate IS the guard: ownership + `review_by_date IS NULL` in the
// same UPDATE, so two concurrent calls cannot both win and there is no
// read-then-write window. Returns null when nothing was updated (not owned
// or already set) — the caller decides which message that deserves.
export async function setReviewByDateIfUnset(
  db: typeof Db,
  params: { decisionId: string; investorId: string; reviewByDate: Date }
) {
  const [row] = await db
    .update(decisions)
    .set({ reviewByDate: params.reviewByDate })
    .where(and(eq(decisions.id, params.decisionId), eq(decisions.investorId, params.investorId), isNull(decisions.reviewByDate)))
    .returning();
  return row ?? null;
}

// The single write path for freezing a Decision Snapshot — this is the
// one insert in the whole schema that most needs to be atomic and
// complete, since nothing about it can ever be corrected after the fact
// (docs/data-model.md §5, §10). Bundles the snapshot row with its DNA
// version references in one transaction.
export async function insertDecisionSnapshot(
  db: DbOrTx,
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

export async function getLaterContextsForDecision(db: typeof Db, decisionId: string) {
  return db.query.laterContexts.findMany({
    where: (lc, { eq }) => eq(lc.decisionId, decisionId),
    orderBy: (lc, { asc }) => asc(lc.addedAt),
  });
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

// Decision Review Integrity V1 — replay lookup by (decision, submission key).
export async function findReviewByIdempotencyKey(db: DbOrTx, decisionId: string, idempotencyKey: string) {
  const [review] = await db
    .select()
    .from(decisionReviews)
    .where(and(eq(decisionReviews.decisionId, decisionId), eq(decisionReviews.idempotencyKey, idempotencyKey)));
  if (!review) return null;
  const dimensions = await db.select().from(reviewDimensions).where(eq(reviewDimensions.decisionReviewId, review.id));
  return { review, dimensions };
}

export type ReviewResolutionInput = {
  predictionId: string;
  status: "confirmed" | "refuted" | "inconclusive";
  note: string;
};

// Decision Review Integrity V1 — THE write path for a review: one short
// transaction, entered only after the AI call has returned (never around
// it). Locks, in this fixed order, the owned decision row and then every
// prediction of its thesis ordered by id; under those locks it
//   1. replays or refuses a submission key that already has a review
//      (same request fingerprint → the existing review, different → CONFLICT),
//   2. recomputes the input-state fingerprint and fails closed if it differs
//      from the one the review was generated against,
//   3. re-checks that every submitted prediction belongs to this thesis and is
//      still pending and that no pending prediction is left unresolved,
//   4. inserts the review, its dimensions and every resolution together.
// Nothing is written on any failure. The partial unique index on
// (decision_id, idempotency_key) stays the final authority: a violation is
// resolved by re-reading the committed review (replay) or CONFLICT, never a
// raw 500 and never a second row.
export async function persistDecisionReviewAtomic(
  db: typeof Db,
  params: {
    investorId: string;
    decisionId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    inputStateFingerprint: string;
    review: Omit<NewDecisionReview, "decisionId" | "idempotencyKey" | "requestFingerprint" | "inputStateFingerprint">;
    dimensions: Omit<NewReviewDimension, "decisionReviewId">[];
    resolutions: readonly ReviewResolutionInput[];
  }
) {
  const replayOrConflict = (existing: NonNullable<Awaited<ReturnType<typeof findReviewByIdempotencyKey>>>) => {
    if (existing.review.requestFingerprint !== params.requestFingerprint) {
      throw new ReviewIdempotencyConflictError("This review submission id was already used with different input.");
    }
    return { ...existing, replayed: true as const };
  };
  try {
    return await db.transaction(async (tx) => {
      const [decision] = await tx
        .select({ id: decisions.id })
        .from(decisions)
        .where(and(eq(decisions.id, params.decisionId), eq(decisions.investorId, params.investorId)))
        .for("update");
      if (!decision) throw new ReviewDecisionNotFoundError("Decision not found.");

      const existing = await findReviewByIdempotencyKey(tx, params.decisionId, params.idempotencyKey);
      if (existing) return replayOrConflict(existing);

      const [snapshot] = await tx
        .select({ thesisId: decisionSnapshots.thesisId })
        .from(decisionSnapshots)
        .where(eq(decisionSnapshots.decisionId, params.decisionId));
      if (!snapshot) throw new ReviewStateChangedError("This decision has no snapshot to review.");

      const locked = await tx
        .select({ id: predictions.id, status: predictions.status })
        .from(predictions)
        .where(eq(predictions.thesisId, snapshot.thesisId))
        .orderBy(asc(predictions.id))
        .for("update");
      if (computeReviewInputStateFingerprint(locked) !== params.inputStateFingerprint) {
        throw new ReviewStateChangedError("Prediction state changed since this review was prepared.");
      }
      const statusById = new Map(locked.map((p) => [p.id, p.status]));
      const submitted = new Set(params.resolutions.map((r) => r.predictionId));
      if (submitted.size !== params.resolutions.length) throw new ReviewStateChangedError("A prediction was resolved more than once.");
      for (const r of params.resolutions) {
        if (statusById.get(r.predictionId) !== "pending") throw new ReviewStateChangedError("A submitted prediction is not a pending prediction of this decision.");
      }
      for (const [id, status] of statusById) {
        if (status === "pending" && !submitted.has(id)) throw new ReviewStateChangedError("A pending prediction was left unresolved.");
      }

      const [review] = await tx
        .insert(decisionReviews)
        .values({
          ...params.review,
          decisionId: params.decisionId,
          idempotencyKey: params.idempotencyKey,
          requestFingerprint: params.requestFingerprint,
          inputStateFingerprint: params.inputStateFingerprint,
        })
        .returning();
      const dimensions = await tx
        .insert(reviewDimensions)
        .values(params.dimensions.map((d) => ({ ...d, decisionReviewId: review!.id })))
        .returning();
      const resolvedAt = new Date();
      for (const r of params.resolutions) {
        const updated = await tx
          .update(predictions)
          .set({ status: r.status, resolvedAt, resolvedByReviewId: review!.id, resolutionNote: r.note })
          .where(and(eq(predictions.id, r.predictionId), eq(predictions.status, "pending")))
          .returning({ id: predictions.id });
        if (updated.length !== 1) throw new ReviewStateChangedError("A submitted prediction is no longer pending.");
      }
      return { review: review!, dimensions, replayed: false as const };
    });
  } catch (err) {
    if (isUniqueViolation(err, "decision_reviews_decision_idempotency_key_unique")) {
      const existing = await findReviewByIdempotencyKey(db, params.decisionId, params.idempotencyKey);
      if (existing) return replayOrConflict(existing);
    }
    throw err;
  }
}

export async function getDecisionReviewsForDecision(db: typeof Db, decisionId: string) {
  return db.query.decisionReviews.findMany({
    where: (r, { eq }) => eq(r.decisionId, decisionId),
    orderBy: (r, { desc }) => desc(r.reviewDate),
    with: { dimensions: true },
  });
}

export async function insertPrediction(db: DbOrTx, values: NewPrediction) {
  const [row] = await db.insert(predictions).values(values).returning();
  return row!;
}

export async function getPredictionsForThesis(db: typeof Db, thesisId: string) {
  return db.query.predictions.findMany({
    where: (p, { eq }) => eq(p.thesisId, thesisId),
    orderBy: (p, { asc }) => asc(p.createdAt),
  });
}

// The one narrow, explicitly-named exception to "predictions are
// write-once": a Prediction's claim is set at creation and never
// changes, but its resolution fields are filled in exactly once, by the
// DecisionReview that resolves it (docs/data-model.md §5). This is not a
// general-purpose update — it only ever moves a prediction from
// "pending" to a resolved state.
// Decision Follow-Through V1 — a re-entry condition ("I'd reconsider if X")
// is resolved by the investor on its own, without a Decision Review: it is a
// trigger, not a claim a review needs to weigh. Same lock order as
// persistDecisionReviewAtomic (decision row, then the prediction row) so a
// concurrent review of the same decision is serialized against it — and the
// review's own state-fingerprint recheck fails closed if this landed first.
// Resolve-once: an identical retry replays; a different resolution of an
// already-resolved condition is a conflict, never an overwrite.
// resolved_by_review_id stays NULL — no review resolved it.
export async function resolveReentryCondition(
  db: typeof Db,
  params: { investorId: string; predictionId: string; status: "confirmed" | "refuted" | "inconclusive"; note: string }
) {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ predictionId: predictions.id, decisionId: decisions.id })
      .from(predictions)
      .innerJoin(decisionSnapshots, eq(decisionSnapshots.thesisId, predictions.thesisId))
      .innerJoin(decisions, eq(decisions.id, decisionSnapshots.decisionId))
      .where(and(eq(predictions.id, params.predictionId), eq(decisions.investorId, params.investorId)));
    if (!owned) throw new PredictionNotFoundError("Prediction not found.");

    await tx.select({ id: decisions.id }).from(decisions).where(eq(decisions.id, owned.decisionId)).for("update");
    const [locked] = await tx.select().from(predictions).where(eq(predictions.id, params.predictionId)).for("update");
    if (!locked) throw new PredictionNotFoundError("Prediction not found.");
    if (locked.kind !== "reentry_condition") {
      throw new PredictionNotReentryConditionError("Only a re-entry condition can be resolved on its own — forecasts are resolved in a Decision Review.");
    }
    if (locked.status !== "pending") {
      if (locked.status === params.status && locked.resolutionNote === params.note) return { prediction: locked, replayed: true as const };
      throw new PredictionAlreadyResolvedError("This condition was already resolved differently; a resolution is recorded once.");
    }
    const [updated] = await tx
      .update(predictions)
      .set({ status: params.status, resolvedAt: new Date(), resolutionNote: params.note, resolvedByReviewId: null })
      .where(and(eq(predictions.id, params.predictionId), eq(predictions.status, "pending")))
      .returning();
    if (!updated) throw new PredictionAlreadyResolvedError("This condition is no longer pending.");
    return { prediction: updated, replayed: false as const };
  });
}

/** Pending re-entry conditions across this investor's decisions — the open checks they set for themselves. Deterministic order. */
export async function listOpenReentryConditions(db: typeof Db, investorId: string) {
  return db
    .select({
      predictionId: predictions.id,
      claimText: predictions.claimText,
      checkableByDate: predictions.checkableByDate,
      createdAt: predictions.createdAt,
      decisionId: decisions.id,
      ticker: decisions.ticker,
      decisionType: decisions.decisionType,
      decisionDate: decisions.decisionDate,
    })
    .from(predictions)
    .innerJoin(decisionSnapshots, eq(decisionSnapshots.thesisId, predictions.thesisId))
    .innerJoin(decisions, eq(decisions.id, decisionSnapshots.decisionId))
    .where(and(eq(decisions.investorId, investorId), eq(predictions.kind, "reentry_condition"), eq(predictions.status, "pending")))
    .orderBy(desc(decisions.decisionDate), asc(decisions.id), asc(predictions.createdAt), asc(predictions.id));
}

/** One prediction with its decision, only when the decision is the investor's. */
export async function getOwnedPrediction(db: typeof Db, investorId: string, predictionId: string) {
  const [row] = await db
    .select({
      predictionId: predictions.id,
      claimText: predictions.claimText,
      kind: predictions.kind,
      status: predictions.status,
      resolutionNote: predictions.resolutionNote,
      resolvedAt: predictions.resolvedAt,
      decisionId: decisions.id,
      ticker: decisions.ticker,
      decisionType: decisions.decisionType,
      decisionDate: decisions.decisionDate,
    })
    .from(predictions)
    .innerJoin(decisionSnapshots, eq(decisionSnapshots.thesisId, predictions.thesisId))
    .innerJoin(decisions, eq(decisions.id, decisionSnapshots.decisionId))
    .where(and(eq(predictions.id, predictionId), eq(decisions.investorId, investorId)));
  return row ?? null;
}

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
