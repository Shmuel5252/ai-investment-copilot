// Decision Review Integrity V1 — the production fingerprint helpers
// (src/lib/review/review-fingerprint.ts): determinism and semantic sensitivity.
import { describe, expect, it } from "vitest";
import { computeReviewInputStateFingerprint, computeReviewRequestFingerprint } from "@/lib/review/review-fingerprint";

const D = "11111111-1111-4111-8111-111111111111";
const a = { predictionId: "aaaaaaaa-0000-4000-8000-000000000001", status: "confirmed", note: "grew 20%" };
const b = { predictionId: "aaaaaaaa-0000-4000-8000-000000000002", status: "refuted", note: "no" };

describe("request fingerprint", () => {
  it("is deterministic and independent of resolution order", () => {
    const x = computeReviewRequestFingerprint({ decisionId: D, resolutions: [a, b] });
    expect(computeReviewRequestFingerprint({ decisionId: D, resolutions: [b, a] })).toBe(x);
    expect(computeReviewRequestFingerprint({ decisionId: D, resolutions: [a, b] })).toBe(x);
    expect(x).toMatch(/^v1:[0-9a-f]{64}$/);
  });
  it("changes with the status, the note (exactly as written), the prediction, or the decision", () => {
    const base = computeReviewRequestFingerprint({ decisionId: D, resolutions: [a] });
    expect(computeReviewRequestFingerprint({ decisionId: D, resolutions: [{ ...a, status: "refuted" }] })).not.toBe(base);
    expect(computeReviewRequestFingerprint({ decisionId: D, resolutions: [{ ...a, note: "grew 21%" }] })).not.toBe(base);
    expect(computeReviewRequestFingerprint({ decisionId: D, resolutions: [{ ...a, note: "grew 20% " }] })).not.toBe(base); // no silent trimming
    expect(computeReviewRequestFingerprint({ decisionId: D, resolutions: [{ ...a, predictionId: b.predictionId }] })).not.toBe(base);
    expect(computeReviewRequestFingerprint({ decisionId: "22222222-2222-4222-8222-222222222222", resolutions: [a] })).not.toBe(base);
    expect(computeReviewRequestFingerprint({ decisionId: D, resolutions: [] })).not.toBe(base);
  });
  it("delimiters in notes cannot make two different requests collide", () => {
    const one = computeReviewRequestFingerprint({ decisionId: D, resolutions: [{ ...a, note: 'x","y' }] });
    const two = computeReviewRequestFingerprint({ decisionId: D, resolutions: [{ ...a, note: "x" }, { ...b, note: "y" }] });
    expect(one).not.toBe(two);
  });
});

describe("input-state fingerprint", () => {
  const p1 = { id: "bbbbbbbb-0000-4000-8000-000000000001", status: "pending" };
  const p2 = { id: "bbbbbbbb-0000-4000-8000-000000000002", status: "confirmed" };
  it("is deterministic, order-independent, and ignores fields other than id and status", () => {
    const x = computeReviewInputStateFingerprint([p1, p2]);
    expect(computeReviewInputStateFingerprint([p2, p1])).toBe(x);
    expect(computeReviewInputStateFingerprint([{ ...p1, claimText: "c" } as never, p2])).toBe(x);
  });
  it("changes when any prediction's status changes, or a prediction is added/removed", () => {
    const x = computeReviewInputStateFingerprint([p1, p2]);
    expect(computeReviewInputStateFingerprint([{ ...p1, status: "refuted" }, p2])).not.toBe(x);
    expect(computeReviewInputStateFingerprint([p1])).not.toBe(x);
    expect(computeReviewInputStateFingerprint([])).not.toBe(x);
  });
  it("request and input-state fingerprints live in different domains", () => {
    expect(computeReviewInputStateFingerprint([])).not.toBe(computeReviewRequestFingerprint({ decisionId: D, resolutions: [] }));
  });
});
