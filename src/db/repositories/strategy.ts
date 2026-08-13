import { eq, desc } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import {
  strategyPrinciples,
  strategyPrincipleVersions,
  strategyVersions,
  strategyVersionPrinciples,
} from "@/db/schema";

export type NewStrategyPrinciple = InferInsertModel<typeof strategyPrinciples>;
export type NewStrategyPrincipleVersion = InferInsertModel<typeof strategyPrincipleVersions>;
export type NewStrategyVersion = InferInsertModel<typeof strategyVersions>;

export async function insertStrategyPrinciple(db: typeof Db, values: NewStrategyPrinciple) {
  const [row] = await db.insert(strategyPrinciples).values(values).returning();
  return row!;
}

// Append-only.
export async function insertStrategyPrincipleVersion(
  db: typeof Db,
  values: NewStrategyPrincipleVersion
) {
  const [row] = await db.insert(strategyPrincipleVersions).values(values).returning();
  return row!;
}

// Bundles a new whole-strategy version together with the set of
// principle-versions active in it (new + carried-over unchanged ones) —
// see docs/data-model.md §0 "Whole-bundle Version". Append-only.
export async function insertStrategyVersion(
  db: typeof Db,
  values: NewStrategyVersion,
  principleVersionIds: string[]
) {
  return db.transaction(async (tx) => {
    const [version] = await tx.insert(strategyVersions).values(values).returning();
    if (principleVersionIds.length > 0) {
      await tx.insert(strategyVersionPrinciples).values(
        principleVersionIds.map((strategyPrincipleVersionId) => ({
          strategyVersionId: version!.id,
          strategyPrincipleVersionId,
        }))
      );
    }
    return version!;
  });
}

export async function getLatestStrategyVersion(db: typeof Db, investorId: string) {
  const [row] = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.investorId, investorId))
    .orderBy(desc(strategyVersions.versionNumber))
    .limit(1);
  return row;
}

export async function getLatestStrategyPrincipleVersion(
  db: typeof Db,
  strategyPrincipleId: string
) {
  const [row] = await db
    .select()
    .from(strategyPrincipleVersions)
    .where(eq(strategyPrincipleVersions.strategyPrincipleId, strategyPrincipleId))
    .orderBy(desc(strategyPrincipleVersions.versionNumber))
    .limit(1);
  return row;
}

// The full set of principle-versions bundled into a given whole-strategy
// version — "what did the Strategy actually say at that point in time".
export async function getStrategyVersionPrinciples(db: typeof Db, strategyVersionId: string) {
  return db.query.strategyVersionPrinciples.findMany({
    where: (svp, { eq }) => eq(svp.strategyVersionId, strategyVersionId),
    with: { principleVersion: true },
  });
}
