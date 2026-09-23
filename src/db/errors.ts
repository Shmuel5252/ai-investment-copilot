// Postgres wraps a constraint violation inside a `cause` on the error
// drizzle/postgres.js throws — the SQLSTATE and constraint name live at
// error.cause.code / error.cause.constraint_name, not the top-level
// message (same shape tests/integration/schema-constraints.test.ts's
// own `causedByConstraint` helper already relies on). "23505" is
// Postgres's SQLSTATE for unique_violation.
//
// Routers use this to turn a genuine concurrent-write conflict on one of
// the UNIQUE(parent, version_number) / UNIQUE(investment_case_id)
// constraints (added after the Strategy double-submit incident — see
// git history) into the same clear TRPCError the equivalent
// application-level check already gives, instead of letting a raw 500
// with an internal SQL message reach the client. Confirmed live before
// writing this: an uncaught violation surfaces exactly that way.
export function isUniqueViolation(err: unknown, constraintName: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint_name?: string } } | undefined)?.cause;
  return cause?.code === "23505" && cause?.constraint_name === constraintName;
}

// Decision Review Integrity V1 (persistDecisionReviewAtomic). Thrown inside
// the persistence transaction, so nothing is written when they escape:
//   ReviewStateChangedError — the locked prediction state no longer matches
//     what the review was prepared/generated against (fail closed; the AI is
//     never re-run automatically);
//   ReviewIdempotencyConflictError — this submission key already belongs to a
//     review created from a DIFFERENT request;
//   ReviewDecisionNotFoundError — the decision is gone or not the investor's.
export class ReviewStateChangedError extends Error {}
export class ReviewIdempotencyConflictError extends Error {}
export class ReviewDecisionNotFoundError extends Error {}

// Thrown by an identity-version append whose counting was computed against a
// base state that has since changed — the identity's latest version is no
// longer the one the generation counted against (another generation,
// remediation or recalculation appended), or that version has gained
// grounding checks since (a remediation's checked_no_change write, which adds
// rows without a new version). The counts and the grounding verdicts to carry
// forward would then describe different states, so nothing is written; the
// caller re-runs against the current state.
export class StaleIdentityVersionError extends Error {
  constructor(
    public readonly identityId: string,
    detail: string
  ) {
    super(`Identity ${identityId}: ${detail} — refusing to append; re-run against the current state.`);
    this.name = "StaleIdentityVersionError";
  }
}
