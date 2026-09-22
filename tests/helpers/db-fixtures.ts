import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

// Integration-test fixtures shared by the DB-backed independence /
// generation suites. Every row is synthetic and lives only in whatever
// (scratch) database DATABASE_URL points at.
type Db = PostgresJsDatabase<typeof schema>;

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function mkInvestor(db: Db, label: string) {
  const [row] = await db
    .insert(schema.investors)
    .values({ email: `fixture-${label}-${uniq()}@example.com`, passwordHash: "not-a-real-hash", displayName: label })
    .returning();
  return row!.id;
}

export async function mkTxn(
  db: Db,
  investorId: string,
  ticker: string,
  type: "buy" | "sell",
  date: string,
  qty: string
) {
  const [row] = await db
    .insert(schema.transactions)
    .values({
      investorId,
      ticker,
      transactionType: type,
      quantity: qty,
      price: "10",
      amount: type === "buy" ? `-${Number(qty) * 10}` : `${Number(qty) * 10}`,
      transactionDate: new Date(date),
      source: "manual_entry",
    })
    .returning();
  return row!.id;
}

export const uniqueKey = (prefix: string) => `${prefix}-${uniq()}`;
