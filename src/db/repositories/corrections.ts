import { eq } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { corrections } from "@/db/schema";

export type NewCorrection = InferInsertModel<typeof corrections>;

// The generic appeal/correction mechanism (docs/data-model.md §5) — one
// insert path for the whole system. A correction row itself is never
// edited; only its `status` (and the resulting*Id pointers) move forward
// as it gets acted on, via markCorrectionResolved below.
export async function insertCorrection(db: typeof Db, values: NewCorrection) {
  const [row] = await db.insert(corrections).values(values).returning();
  return row!;
}

// Returns the updated row — caught live (Learning Insight task): the
// first caller (learning.agree/disagree) kept returning the Correction
// object captured *before* this ran, so callers saw status still
// "pending" and resultingVersionId still null even after a successful
// resolution. `.returning()` here is the fix; callers should use this
// return value instead of holding onto their pre-resolution copy.
export async function markCorrectionResolved(
  db: typeof Db,
  correctionId: string,
  resolution:
    | { status: "led_to_new_review"; resultingReviewId: string }
    | { status: "led_to_new_version"; resultingVersionId: string }
    | { status: "noted" }
) {
  const [row] = await db
    .update(corrections)
    .set({
      status: resolution.status,
      resultingReviewId: "resultingReviewId" in resolution ? resolution.resultingReviewId : undefined,
      resultingVersionId:
        "resultingVersionId" in resolution ? resolution.resultingVersionId : undefined,
    })
    .where(eq(corrections.id, correctionId))
    .returning();
  return row!;
}
