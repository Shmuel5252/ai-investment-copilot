import { drizzle } from "drizzle-orm/postgres-js";
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
