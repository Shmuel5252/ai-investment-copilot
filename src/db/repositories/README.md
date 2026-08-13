# Repositories

Application code writes to the tables listed in `docs/data-model.md` §10
("אין UPDATE/DELETE בכלל") **only** through the functions in this
directory — never via `db.update(...)` / `db.delete(...)` on those tables
directly elsewhere in the codebase. Each function here only exposes
`insert` (plus narrow, explicitly-named exceptions like
`resolvePrediction`, which writes a one-time resolution onto an otherwise
immutable row — see decisions.ts).

This is a convention enforced by code review, not a DB-level or
type-level guarantee (Postgres itself has no notion of "insert-only" for
a table without triggers, which would be more machinery than a
single-developer project needs — see CLAUDE.md "no over-engineering").
The DB-level backstop that *does* exist is the `ON DELETE RESTRICT`
constraints on decision_snapshots' FKs (docs/data-model.md §10), which
make the one operation that would actually corrupt history — deleting a
referenced version row — impossible regardless of which code path
attempts it.
