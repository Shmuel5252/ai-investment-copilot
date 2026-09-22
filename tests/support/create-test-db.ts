// Creates / drops an authorized TEST database on the local Postgres server.
//
//   npm run db:test:create [-- <name>]   create a new EMPTY database and mark it
//   npm run db:test:drop -- <name>       drop a database — refuses unless it carries the marker
//
// The application DATABASE_URL is used ONLY to reach the server's
// maintenance database ("postgres") — the application's own database is never
// connected to, and a name equal to it is refused. Existing databases are
// never marked: the marker exists only on databases this tool created, so
// the real database cannot pick it up by accident. Nothing prints a
// connection string, host or user.
import "dotenv/config";
import postgres from "postgres";
import { TEST_DATABASE_ENV, TEST_DATABASE_MARKER } from "./test-database";

const [, , action, requested] = process.argv;
const NAME = /^[a-z][a-z0-9_]{2,62}$/;

/** A refusal or validation failure this tool raised itself — always safe to print. */
class ToolError extends Error {}

async function main() {
  if (action !== "create" && action !== "drop") throw new ToolError("usage: create-test-db.ts create [name] | drop <name>");
  const appUrl = process.env.DATABASE_URL;
  if (!appUrl) throw new ToolError("DATABASE_URL is not set (needed only to reach the database server).");
  const app = new URL(appUrl);
  const appDatabase = decodeURIComponent(app.pathname.replace(/^\//, ""));

  const name = requested ?? (action === "create" ? `aic_test_${Date.now()}` : "");
  if (!NAME.test(name)) throw new ToolError("database name must match /^[a-z][a-z0-9_]{2,62}$/");
  if (name === appDatabase || name === "postgres") throw new ToolError(`refusing to touch "${name}" (application or maintenance database)`);

  const admin = new URL(appUrl);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    if (action === "create") {
      await sql.unsafe(`CREATE DATABASE "${name}"`);
      await sql.unsafe(`COMMENT ON DATABASE "${name}" IS '${TEST_DATABASE_MARKER}'`);
      console.log(`Created and marked test database "${name}" (empty; migrations are applied automatically by the test run).`);
      console.log(`Set ${TEST_DATABASE_ENV} to your DATABASE_URL with the database name replaced by "${name}", then run \`npm test\`.`);
    } else {
      const [row] = await sql<{ marker: string | null }[]>`
        select shobj_description(oid, 'pg_database') as marker from pg_database where datname = ${name}`;
      if (!row) throw new ToolError(`database "${name}" does not exist`);
      if (row.marker !== TEST_DATABASE_MARKER) throw new ToolError(`refusing to drop "${name}": it does not carry the test-database marker`);
      await sql.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log(`Dropped test database "${name}".`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  // Only this tool's own messages, or a message the SERVER reported (e.g. "already exists").
  // A driver/network error's message names the host it tried to reach — never print that.
  const e = err as { message?: unknown; severity?: unknown; code?: unknown } | null;
  const detail =
    err instanceof ToolError
      ? err.message
      : typeof e?.severity === "string" && typeof e.message === "string"
        ? e.message
        : `could not reach the database server (${typeof e?.code === "string" ? e.code : "unknown error"})`;
  console.error("db:test failed:", detail);
  process.exit(1);
});
