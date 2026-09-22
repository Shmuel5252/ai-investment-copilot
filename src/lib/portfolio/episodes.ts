import { QUANTITY_EPSILON, type PortfolioState } from "./positions";

// Episode Journal V1 — the DERIVED view of the investor's position history
// (docs/architecture.md §2.2 "Tell me why", docs/data-model.md §9). An
// episode is one continuous open-to-flat lifecycle of one ticker. This file
// owns NO episode semantics of its own: which transaction belongs to which
// episode comes exclusively from computePositions().episodeKeyByTransactionId
// (src/lib/portfolio/positions.ts, deriveEpisodeKeys) — the exact same map
// the Decision Independence resolver counts evidence by — and every number
// here (realized P&L, holding days) is read from computePositions()'s own
// sellTrace, never re-derived. Pure: no DB, no AI, nothing persisted; a
// later call simply recomputes the whole journal from the current rows.
//
// Two facts the journal adds on top of the position math, both
// deterministic:
//   - the ANCHOR of an episode: its earliest BUY (by date, then declared
//     intra-day order, then id). A rationale recorded through the journal is
//     persisted as an ordinary InterviewAnswer whose transaction_id IS this
//     anchor (docs/data-model.md §9; the MP precedent) — the free text may
//     describe the whole episode. An episode with no BUY at all (a position
//     opened before the imported window, or a sell that exceeded known
//     holdings) has no deterministic anchor and is NOT guessed at: `entry`
//     is null and the router refuses to start "Tell me why" for it.
//   - rationale COVERAGE: an episode is covered when at least one EFFECTIVE
//     (non-superseded) InterviewAnswer anchors to any of its transactions.
//     Several answers about one episode are one covered episode; a
//     superseded answer never counts (the caller passes
//     getAllAnswersForInvestor's output, which already drops superseded
//     rows — the one reader dna.generate / strategy.generateObserved use).
//
// Hindsight protection lives one layer up (src/lib/interview/journal.ts):
// this derivation computes the later/outcome facts for EVERY episode so the
// tests can prove the projection withholds them until a rationale exists.

export interface EpisodeTransactionInput {
  id: string;
  ticker: string | null;
  transactionType: string;
  quantity: number | null;
  price: number | null;
  amount: number;
  transactionDate: Date;
  /** Declared same-day order (docs/data-model.md §6) — display tie-break only. */
  intraDayOrder?: number | null;
}

/** An EFFECTIVE answer (already filtered of superseded rows by the caller). */
export interface EpisodeAnswerInput {
  id: string;
  transactionId: string | null;
  questionText: string;
  answerText: string;
  createdAt: Date;
}

export interface EpisodeTransactionFact {
  id: string;
  side: "buy" | "sell";
  quantity: number | null;
  price: number | null;
  amount: number;
  date: Date;
}

/** Contemporaneous facts of the entry decision — safe to show BEFORE a rationale is written. */
export interface EpisodeEntryFacts {
  transactionId: string;
  date: Date;
  quantity: number | null;
  price: number | null;
  amount: number;
}

export interface EpisodeSellFact {
  transactionId: string;
  date: Date;
  /** Straight from computePositions().sellTrace — never recomputed here. */
  realizedPnlPercent: number;
  holdingPeriodDays: number;
  sufficientHoldings: boolean;
}

/** Post-decision facts — outcome-loaded; shown only AFTER a rationale exists. */
export interface EpisodeLaterFacts {
  exitDate: Date | null;
  /** Calendar days from the entry anchor to the last sell of a closed episode; null while open or unanchored. */
  holdingDays: number | null;
  sells: EpisodeSellFact[];
}

export interface EpisodeRationale {
  status: "answered" | "unanswered";
  /** Effective answers anchored to this episode, oldest first. */
  answers: EpisodeAnswerInput[];
  latestAnswerId: string | null;
}

export interface JournalEpisode {
  /** computePositions()'s episode key, e.g. "MP#1". */
  key: string;
  ticker: string;
  episodeNumber: number;
  status: "open" | "closed";
  /** The episode's buy/sell transactions, chronological. */
  transactions: EpisodeTransactionFact[];
  buyCount: number;
  sellCount: number;
  /** Date of the episode's first transaction (buy or sell). */
  firstDate: Date;
  /** null = no BUY in the episode: no deterministic anchor, "Tell me why" is refused (fail closed). */
  entry: EpisodeEntryFacts | null;
  later: EpisodeLaterFacts;
  rationale: EpisodeRationale;
}

export interface EpisodeJournal {
  /** Unanswered episodes first, each group newest first (see sortJournalEpisodes). */
  episodes: JournalEpisode[];
  coverage: { covered: number; total: number };
}

const MS_PER_DAY = 86_400_000;

function compareTransactions(a: EpisodeTransactionInput, b: EpisodeTransactionInput): number {
  const byDate = a.transactionDate.getTime() - b.transactionDate.getTime();
  if (byDate !== 0) return byDate;
  const oa = a.intraDayOrder ?? Number.POSITIVE_INFINITY;
  const ob = b.intraDayOrder ?? Number.POSITIVE_INFINITY;
  if (oa !== ob) return oa - ob;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function episodeNumberOf(key: string): number {
  const n = Number(key.slice(key.lastIndexOf("#") + 1));
  if (!Number.isInteger(n) || n < 1) throw new Error(`deriveEpisodeJournal: malformed episode key "${key}".`);
  return n;
}

// Deterministic, meaningful, no ranking model: what still needs a rationale
// comes first; within each group the most recent entry first (the decision
// the investor can still remember best), then ticker, then episode number.
export function sortJournalEpisodes(episodes: readonly JournalEpisode[]): JournalEpisode[] {
  return [...episodes].sort((a, b) => {
    if (a.rationale.status !== b.rationale.status) return a.rationale.status === "unanswered" ? -1 : 1;
    const byDate = b.firstDate.getTime() - a.firstDate.getTime();
    if (byDate !== 0) return byDate;
    const byTicker = a.ticker.localeCompare(b.ticker);
    if (byTicker !== 0) return byTicker;
    return a.episodeNumber - b.episodeNumber;
  });
}

export function deriveEpisodeJournal(
  transactions: readonly EpisodeTransactionInput[],
  portfolio: PortfolioState,
  effectiveAnswers: readonly EpisodeAnswerInput[]
): EpisodeJournal {
  const byId = new Map(transactions.map((t) => [t.id, t]));

  // 1. Group the position math's own episode assignment; never re-derive it.
  const members = new Map<string, EpisodeTransactionInput[]>();
  for (const [txnId, key] of portfolio.episodeKeyByTransactionId) {
    const txn = byId.get(txnId);
    if (!txn) throw new Error(`deriveEpisodeJournal: episode key "${key}" refers to transaction ${txnId} that was not passed in.`);
    members.set(key, [...(members.get(key) ?? []), txn]);
  }

  const openTickers = new Set(portfolio.positions.filter((p) => p.quantity > QUANTITY_EPSILON).map((p) => p.ticker));
  const latestEpisodeByTicker = new Map<string, number>();
  for (const [key, txns] of members) {
    const ticker = txns[0]!.ticker!;
    latestEpisodeByTicker.set(ticker, Math.max(latestEpisodeByTicker.get(ticker) ?? 0, episodeNumberOf(key)));
  }

  const sellsByTransaction = new Map(
    portfolio.sellTrace.filter((s) => s.transactionId !== undefined).map((s) => [s.transactionId!, s])
  );
  const answersByTransaction = new Map<string, EpisodeAnswerInput[]>();
  for (const a of effectiveAnswers) {
    if (a.transactionId === null) continue;
    answersByTransaction.set(a.transactionId, [...(answersByTransaction.get(a.transactionId) ?? []), a]);
  }

  const episodes: JournalEpisode[] = [];
  for (const [key, unsorted] of members) {
    const txns = [...unsorted].sort(compareTransactions);
    const ticker = txns[0]!.ticker!;
    const episodeNumber = episodeNumberOf(key);
    const facts: EpisodeTransactionFact[] = txns.map((t) => ({
      id: t.id,
      side: t.transactionType as "buy" | "sell",
      quantity: t.quantity,
      price: t.price,
      amount: t.amount,
      date: t.transactionDate,
    }));

    const entryTxn = txns.find((t) => t.transactionType === "buy") ?? null;
    const entry: EpisodeEntryFacts | null = entryTxn
      ? { transactionId: entryTxn.id, date: entryTxn.transactionDate, quantity: entryTxn.quantity, price: entryTxn.price, amount: entryTxn.amount }
      : null;

    const status: "open" | "closed" =
      openTickers.has(ticker) && latestEpisodeByTicker.get(ticker) === episodeNumber ? "open" : "closed";

    const sells: EpisodeSellFact[] = txns
      .filter((t) => t.transactionType === "sell")
      .map((t) => sellsByTransaction.get(t.id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)
      .map((s) => ({
        transactionId: s.transactionId!,
        date: s.transactionDate,
        realizedPnlPercent: s.realizedPnlPercent,
        holdingPeriodDays: s.holdingPeriodDays,
        sufficientHoldings: s.sufficientHoldings,
      }));
    const lastSell = txns.filter((t) => t.transactionType === "sell").at(-1) ?? null;
    const exitDate = status === "closed" && lastSell ? lastSell.transactionDate : null;
    const holdingDays =
      exitDate && entry ? Math.round((exitDate.getTime() - entry.date.getTime()) / MS_PER_DAY) : null;

    const answers = txns
      .flatMap((t) => answersByTransaction.get(t.id) ?? [])
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));

    episodes.push({
      key,
      ticker,
      episodeNumber,
      status,
      transactions: facts,
      buyCount: facts.filter((f) => f.side === "buy").length,
      sellCount: facts.filter((f) => f.side === "sell").length,
      firstDate: txns[0]!.transactionDate,
      entry,
      later: { exitDate, holdingDays, sells },
      rationale: {
        status: answers.length > 0 ? "answered" : "unanswered",
        answers,
        latestAnswerId: answers.length > 0 ? answers[answers.length - 1]!.id : null,
      },
    });
  }

  const sorted = sortJournalEpisodes(episodes);
  return {
    episodes: sorted,
    coverage: { covered: sorted.filter((e) => e.rationale.status === "answered").length, total: sorted.length },
  };
}

/** The episode a transaction belongs to, or null when the position math assigned it none (non-trade, no ticker). */
export function findEpisodeByTransaction(journal: EpisodeJournal, transactionId: string): JournalEpisode | null {
  return journal.episodes.find((e) => e.transactions.some((t) => t.id === transactionId)) ?? null;
}
