// Decision Independence V1 — pure rules for authoritative LinkFacts (no DB,
// no AI). The repository (src/db/repositories/link-facts.ts) feeds these
// with persisted rows and enforces the same rules atomically on insert.

export interface LinkFactMemberTransaction {
  id: string;
  investorId: string;
  ticker: string | null;
  transactionType: string;
}

export interface LinkFactShapeInput {
  investorId: string;
  verdict: "linked" | "independent";
  requestedTransactionIds: readonly string[];
  /** The persisted transaction rows found for requestedTransactionIds (may be fewer than requested). */
  foundTransactions: readonly LinkFactMemberTransaction[];
}

// Returns every violated rule (empty = valid). Members are always trades
// (buy/sell with a ticker): dependence between a dividend or a fee and a
// purchase is not a capital-reallocation decision, for either verdict.
export function validateLinkFactShape(input: LinkFactShapeInput): string[] {
  const errors: string[] = [];
  const ids = input.requestedTransactionIds;

  if (new Set(ids).size !== ids.length) errors.push("Duplicate transaction ids in one fact.");
  if (new Set(ids).size < 2) errors.push("A link fact needs at least 2 distinct transactions.");

  const found = new Map(input.foundTransactions.map((t) => [t.id, t]));
  const missing = [...new Set(ids)].filter((id) => !found.has(id));
  if (missing.length > 0) errors.push(`Unknown transaction(s): ${missing.join(", ")}.`);

  const foreign = input.foundTransactions.filter((t) => t.investorId !== input.investorId);
  if (foreign.length > 0) errors.push("Every transaction must belong to the investor of the fact.");

  const notTrades = input.foundTransactions.filter(
    (t) => (t.transactionType !== "buy" && t.transactionType !== "sell") || t.ticker === null || t.ticker === ""
  );
  if (notTrades.length > 0) errors.push("Every member must be a buy or sell trade with a ticker.");

  if (input.verdict === "linked") {
    const trades = input.foundTransactions.filter((t) => !notTrades.includes(t));
    if (!trades.some((t) => t.transactionType === "sell")) errors.push("A linked fact needs at least one sell.");
    if (!trades.some((t) => t.transactionType === "buy")) errors.push("A linked fact needs at least one buy.");
    if (new Set(trades.map((t) => t.ticker)).size < 2) errors.push("A linked fact needs at least 2 distinct tickers.");
  }

  return errors;
}

export interface LinkFactRow {
  id: string;
  verdict: "linked" | "independent";
  supersedesFactId: string | null;
  transactionIds: readonly string[];
}

// Chain heads: every fact that no other fact supersedes.
export function selectEffectiveLinkFacts<T extends { id: string; supersedesFactId: string | null }>(
  facts: readonly T[]
): T[] {
  const superseded = new Set(facts.map((f) => f.supersedesFactId).filter((id): id is string => id !== null));
  return facts.filter((f) => !superseded.has(f.id));
}

// Effective facts of the OPPOSITE verdict that already cover at least one
// pair the new fact covers (two shared members = one shared pair). Called
// with the effective set AFTER removing the fact being superseded — an
// opposite verdict is only allowed by superseding what it contradicts.
export function findLinkFactConflicts(
  next: { verdict: "linked" | "independent"; transactionIds: readonly string[] },
  effectiveAfterSupersession: readonly LinkFactRow[]
): LinkFactRow[] {
  const mine = new Set(next.transactionIds);
  return effectiveAfterSupersession.filter(
    (f) => f.verdict !== next.verdict && f.transactionIds.filter((id) => mine.has(id)).length >= 2
  );
}
