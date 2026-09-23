// Decision Review Integrity V1 — the two canonical fingerprints stored on a
// DecisionReview (docs/data-model.md §5). Pure, deterministic, versioned:
//
//   request fingerprint     — WHAT the investor submitted: the decision and
//                             every prediction resolution (id, status, note),
//                             order-independent. Same idempotency key + a
//                             different request fingerprint = CONFLICT, never
//                             a silent reuse. The note is hashed exactly as
//                             submitted (no trimming/case folding): changing
//                             the investor's words is a different request.
//   input-state fingerprint — the Prediction state the AI review was generated
//                             against: every prediction of the thesis as
//                             (id, status), sorted by id. The atomic
//                             persistence phase recomputes it on locked rows;
//                             any difference fails closed (claim text and kind
//                             are immutable after creation, so id + status is
//                             the whole mutable state that matters).
//
// The version tag is inside the hashed payload and on the stored value, so a
// future change of either definition can never collide with v1 values.
import { createHash } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const compareTuples = (a: string[], b: string[]) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

export interface ReviewRequestFingerprintInput {
  decisionId: string;
  resolutions: readonly { predictionId: string; status: string; note: string }[];
}

export function computeReviewRequestFingerprint(input: ReviewRequestFingerprintInput): string {
  const resolutions = input.resolutions.map((r) => [r.predictionId, r.status, r.note]).sort(compareTuples);
  return `v1:${sha256(JSON.stringify(["review-request", "v1", input.decisionId, resolutions]))}`;
}

export function computeReviewInputStateFingerprint(predictions: readonly { id: string; status: string }[]): string {
  const state = predictions.map((p) => [p.id, p.status]).sort(compareTuples);
  return `v1:${sha256(JSON.stringify(["review-input-state", "v1", state]))}`;
}
