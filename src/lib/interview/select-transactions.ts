import { buildAnchorContext, type AnchorContextV1, type AnchorHistory, type HistoryTransaction } from "./anchor-context";

// Guided Interview PIT contract (Unit 7C-B) — which historical actions the
// guided interview asks about. STRUCTURAL ONLY (Owner decision): no outcome
// metric takes part in eligibility, slot choice or tie-breaking. The old
// biggest_gain / biggest_loss / longest_hold / quickest_flip slots chose the
// sample by result and handed that result to the question; they are gone.
//
// Eligibility: a buy or sell with a ticker whose point-in-time context can be
// built (src/lib/interview/anchor-context.ts) — so a sell is backed by known
// holdings, the ticker's history before it is trusted, and its same-day
// order is authoritative. Any action that already has an EFFECTIVE answer
// anchored to that exact transaction is skipped, whatever its role (Unit 7C-F
// backend delta): it is already recorded, and each slot moves on to its next
// candidate. Identity is the transaction id, never ticker, episode or date.
//
// Slots, filled in this fixed order, each taking the most recent eligible
// action not already taken (recency is a fact of the calendar, not of the
// result): initial buy, add-on buy, partial sell, full sell, the largest
// entry by its own cost at the time (quantity × fill price of the buy), the
// most recent eligible action. The session then presents them in
// chronological order.

export type StructuralSlot = "initial_buy" | "add_buy" | "partial_sell" | "full_sell" | "largest_entry" | "most_recent";
export const MAX_GUIDED_QUESTIONS = 6;

export interface SelectedAnchor {
  slot: StructuralSlot;
  transaction: HistoryTransaction;
  context: AnchorContextV1;
}

function newestFirst(a: HistoryTransaction, b: HistoryTransaction): number {
  const d = b.transactionDate.getTime() - a.transactionDate.getTime();
  if (d !== 0) return d;
  const oa = a.intraDayOrder ?? Number.NEGATIVE_INFINITY;
  const ob = b.intraDayOrder ?? Number.NEGATIVE_INFINITY;
  if (oa !== ob) return ob - oa;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function selectStructuralAnchors(
  history: AnchorHistory,
  options: { answeredTransactionIds: ReadonlySet<string>; maxCount?: number }
): SelectedAnchor[] {
  const eligible: { transaction: HistoryTransaction; context: AnchorContextV1 }[] = [];
  for (const t of [...history.transactions].sort(newestFirst)) {
    if (t.ticker === null || (t.transactionType !== "buy" && t.transactionType !== "sell")) continue;
    const built = buildAnchorContext(history, t.id);
    if (!built.ok) continue;
    if (options.answeredTransactionIds.has(t.id)) continue;
    eligible.push({ transaction: t, context: built.context });
  }

  const taken = new Set<string>();
  const picked: SelectedAnchor[] = [];
  const take = (slot: StructuralSlot, pool: typeof eligible) => {
    const next = pool.find((e) => !taken.has(e.transaction.id));
    if (!next) return;
    taken.add(next.transaction.id);
    picked.push({ slot, ...next });
  };

  for (const role of ["initial_buy", "add_buy", "partial_sell", "full_sell"] as const) take(role, eligible.filter((e) => e.context.anchor.role === role));
  const cost = (t: HistoryTransaction) => (t.quantity ?? 0) * (t.price ?? 0);
  // Stable sort keeps newest-first among equal costs.
  take("largest_entry", eligible.filter((e) => e.context.anchor.side === "buy").sort((a, b) => cost(b.transaction) - cost(a.transaction)));
  take("most_recent", eligible);

  return picked
    .slice(0, options.maxCount ?? MAX_GUIDED_QUESTIONS)
    .sort((a, b) => newestFirst(b.transaction, a.transaction));
}
