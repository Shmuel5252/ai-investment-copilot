// Creates (or updates the password of) the single investor account.
// This is a personal, single-user product — there is no signup flow.
//
// Usage:
//   SEED_INVESTOR_EMAIL=you@example.com SEED_INVESTOR_PASSWORD=... \
//   SEED_INVESTOR_NAME="Your Name" npm run db:seed
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { hashPassword } from "../server/auth/password";

async function main() {
  const email = process.env.SEED_INVESTOR_EMAIL;
  const password = process.env.SEED_INVESTOR_PASSWORD;
  const displayName = process.env.SEED_INVESTOR_NAME ?? "Investor";

  if (!email || !password) {
    throw new Error(
      "Set SEED_INVESTOR_EMAIL and SEED_INVESTOR_PASSWORD env vars before running db:seed."
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }

  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });

  const passwordHash = await hashPassword(password);
  const existing = await db.query.investors.findFirst({
    where: eq(schema.investors.email, email),
  });

  if (existing) {
    await db
      .update(schema.investors)
      .set({ passwordHash, displayName })
      .where(eq(schema.investors.id, existing.id));
    console.log(`Updated investor ${email}.`);
  } else {
    await db.insert(schema.investors).values({ email, passwordHash, displayName });
    console.log(`Created investor ${email}.`);
  }

  await client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
