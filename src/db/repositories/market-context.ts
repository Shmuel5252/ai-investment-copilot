import { and, desc, eq, gt } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { marketContexts } from "@/db/schema";

export type NewMarketContext = InferInsertModel<typeof marketContexts>;

// Immutable from the moment it's captured (docs/data-model.md §7) —
// insert-only, referenced by DecisionSnapshot with ON DELETE RESTRICT.
// No update/delete exposed here, matching every other fully-immutable
// table's repository (docs/data-model.md §10).
export async function insertMarketContext(db: typeof Db, values: NewMarketContext) {
  const [row] = await db.insert(marketContexts).values(values).returning();
  return row!;
}

export async function getMarketContextById(db: typeof Db, id: string) {
  return db.query.marketContexts.findFirst({ where: (m, { eq }) => eq(m.id, id) });
}

// `source` is required (not just an age cutoff) — caught live: a
// same-DB integration test fixture (tests/integration/decisions-repository.test.ts
// inserts a MarketContext row with source="test" and every other field
// null) landed inside the reuse window and got served up as if it were a
// real capture, silently skipping the actual FMP fetch. Reuse must only
// ever match rows this same code path itself inserted.
export async function getRecentMarketContext(db: typeof Db, maxAgeMs: number, source: string) {
  const [row] = await db
    .select()
    .from(marketContexts)
    .where(
      and(gt(marketContexts.capturedAt, new Date(Date.now() - maxAgeMs)), eq(marketContexts.source, source))
    )
    .orderBy(desc(marketContexts.capturedAt))
    .limit(1);
  return row;
}
