import { drizzle } from "drizzle-orm/postgres-js";
import { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
}

// A single shared connection pool for the whole app. postgres.js handles
// pooling internally; this module is imported once and reused (Next.js
// dedupes module instances per server process).
const queryClient = postgres(process.env.DATABASE_URL, { max: 10 });

export const db = drizzle(queryClient, { schema });

// Shared base type for repository functions that need to run either as
// a standalone call (the top-level `db` above) or inside an outer
// db.transaction(async (tx) => {...}) (docs/backlog.md, Decision
// creation atomicity). `typeof db` itself doesn't work for this: the
// drizzle() factory return type is `PostgresJsDatabase<Schema> &
// { $client: Sql<{}> }` — that `$client` property only exists on the
// concrete top-level instance, not on a transaction's `tx`, so a
// function typed `db: typeof db` rejects `tx` with a real compile
// error ("Property '$client' is missing"), confirmed with an actual
// tsc run before writing this. PostgresJsDatabase and PgTransaction
// both extend this same PgDatabase<PostgresJsQueryResultHKT, Schema>
// base (node_modules/drizzle-orm/pg-core/db.d.ts,
// postgres-js/driver.d.ts, pg-core/session.d.ts) — neither has $client
// on it, so both the top-level db and any tx (including one nested
// inside another tx, which becomes a SAVEPOINT — same file, session.js)
// are assignable to it, confirmed with a second real tsc run.
export type DbOrTx = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
