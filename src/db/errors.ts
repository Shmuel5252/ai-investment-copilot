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
