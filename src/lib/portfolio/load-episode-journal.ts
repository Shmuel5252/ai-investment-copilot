// The one DB loader for the derived Episode Journal (src/lib/portfolio/episodes.ts).
// Moved out of src/server/routers/interview.ts (Prior Record Brief V1) so the
// journal, "Tell me why" and the prior-record brief all derive episodes from
// the exact same inputs: computePositionsForInvestor()'s split-aware episode
// map, the investor's transactions and the EFFECTIVE answers — the reader
// DNA/Strategy generation consume. Read-only; nothing is stored.
import type { db as Db } from "@/db/client";
import { listTransactionsForInvestor } from "@/db/repositories/portfolio";
import { getAllAnswersForInvestor } from "@/db/repositories/interview";
import { computePositionsForInvestor } from "./compute-for-investor";
import { deriveEpisodeJournal, type EpisodeJournal } from "./episodes";
import type { PortfolioState } from "./positions";

export interface EpisodeJournalCutoff {
  /** Point-in-time: only transactions dated on/before this instant enter the accounting (same rule as computePositionsForInvestor). */
  asOf?: Date;
  /** Extra knowability predicate on each transaction row (Prior Record Brief V1). */
  includeTransaction?: (row: { transactionDate: Date; createdAt: Date }) => boolean;
  /** Extra predicate on each effective answer (e.g. written on/before the cutoff). */
  includeAnswer?: (answer: { createdAt: Date }) => boolean;
}

export async function loadEpisodeJournalWithPortfolio(
  db: typeof Db,
  investorId: string,
  cutoff: EpisodeJournalCutoff = {}
): Promise<{ journal: EpisodeJournal; portfolio: PortfolioState; transactions: { transactionDate: Date }[] }> {
  const [portfolio, allTransactions, allAnswers] = await Promise.all([
    computePositionsForInvestor(db, investorId, cutoff.asOf, { includeTransaction: cutoff.includeTransaction }),
    listTransactionsForInvestor(db, investorId),
    getAllAnswersForInvestor(db, investorId),
  ]);
  // Exactly the rows the accounting above saw — never more, never fewer.
  const transactions = allTransactions.filter(
    (t) => (!cutoff.asOf || t.transactionDate.getTime() <= cutoff.asOf.getTime()) && (!cutoff.includeTransaction || cutoff.includeTransaction(t))
  );
  const answers = cutoff.includeAnswer ? allAnswers.filter((a) => cutoff.includeAnswer!(a)) : allAnswers;
  const journal = deriveEpisodeJournal(
    transactions.map((t) => ({
      id: t.id,
      ticker: t.ticker,
      transactionType: t.transactionType,
      quantity: t.quantity === null ? null : Number(t.quantity),
      price: t.price === null ? null : Number(t.price),
      amount: Number(t.amount),
      transactionDate: t.transactionDate,
      intraDayOrder: t.intraDayOrder,
    })),
    portfolio,
    answers
  );
  return { journal, portfolio, transactions };
}

export async function loadEpisodeJournal(db: typeof Db, investorId: string): Promise<EpisodeJournal> {
  return (await loadEpisodeJournalWithPortfolio(db, investorId)).journal;
}
