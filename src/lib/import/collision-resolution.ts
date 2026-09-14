// Same-day ordering — collision detection (Investment Episode
// Independence design, "Ordering contract"). Pure, deterministic,
// DB-free: used both by the read-only preview queries (import.ts's
// `validate` and `checkManualEntryCollisions`) and, indirectly, by the
// atomic confirm-time contract in src/db/repositories/portfolio.ts
// (confirmTransactionsWithOrdering), which re-derives the same grouping
// fresh, inside the lock, rather than trusting a client-supplied preview.
//
// A "collision" is >1 transaction sharing (investorId is implicit —
// callers always scope rows to one investor already, ticker,
// transactionDate) — exact timestamp equality, the same granularity the
// migration's partial unique index and backfill use (see
// src/db/migrations/0007_wild_unus.sql). Not filtered by transaction
// type on purpose, for the same reason the backfill wasn't: keeping "what
// counts as a collision" one single, simple rule everywhere, rather than
// a second, narrower definition just for display.
export interface CollisionRow {
  ticker: string | null;
  transactionDate: Date;
}

export interface ExistingCollisionRow extends CollisionRow {
  id: string;
  intraDayOrder: number | null;
  orderUnknownReason: "user_declared" | "never_recorded" | null;
}

export interface NewCollisionRow extends CollisionRow {
  /** Caller-assigned correlation key for a not-yet-persisted row — stable across the preview call and the later confirm call. */
  clientRowKey: string;
}

export interface CollisionGroup {
  ticker: string;
  transactionDate: Date;
  existing: ExistingCollisionRow[];
  incoming: NewCollisionRow[];
}

function groupKey(ticker: string, date: Date): string {
  return `${ticker}::${date.getTime()}`;
}

// Groups incoming (not-yet-persisted) rows against each other AND against
// already-persisted rows for the same investor, returning only the
// groups that actually collide (>1 total member). A ticker with no
// collision at all contributes nothing to the result.
export function detectCollisionGroups(
  incomingRows: NewCollisionRow[],
  existingRows: ExistingCollisionRow[]
): CollisionGroup[] {
  const byKey = new Map<string, CollisionGroup>();

  const groupFor = (ticker: string, date: Date) => {
    const key = groupKey(ticker, date);
    let group = byKey.get(key);
    if (!group) {
      group = { ticker, transactionDate: date, existing: [], incoming: [] };
      byKey.set(key, group);
    }
    return group;
  };

  for (const row of existingRows) {
    if (!row.ticker) continue;
    groupFor(row.ticker, row.transactionDate).existing.push(row);
  }
  for (const row of incomingRows) {
    if (!row.ticker) continue;
    groupFor(row.ticker, row.transactionDate).incoming.push(row);
  }

  return [...byKey.values()].filter((g) => g.existing.length + g.incoming.length > 1);
}
