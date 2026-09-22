import type { db as Db } from "@/db/client";
import { getAllAnswersForInvestor } from "@/db/repositories/interview";
import { loadEffectiveLinkFacts } from "@/db/repositories/link-facts";
import { listTransactionsForInvestor } from "@/db/repositories/portfolio";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";
import {
  createIndependenceResolver,
  type EvidenceIndependenceResolver,
  type IndependenceAnswer,
  type IndependenceContext,
} from "./resolve-independence";

// Thin DB-fetching wrapper around the pure resolver, exactly like
// computePositionsForInvestor wraps computePositions: every input is a
// persisted row (transactions, the investor's own answers, effective
// LinkFacts) plus the episode keys computePositions already derives. It
// reads only — nothing here writes, calls an AI, or accepts candidates.
//
// Callers that already fetched the investor's current answers (dna.generate,
// strategy.generateObserved) pass them in to avoid a second read.
export async function loadIndependenceContext(
  db: typeof Db,
  investorId: string,
  answers?: readonly IndependenceAnswer[]
): Promise<IndependenceContext> {
  const [positions, transactionRows, facts, answerRows] = await Promise.all([
    computePositionsForInvestor(db, investorId),
    listTransactionsForInvestor(db, investorId),
    loadEffectiveLinkFacts(db, investorId),
    answers ?? getAllAnswersForInvestor(db, investorId),
  ]);

  return {
    episodeKeyByTransactionId: positions.episodeKeyByTransactionId,
    transactions: transactionRows.map((t) => ({
      id: t.id,
      ticker: t.ticker,
      transactionType: t.transactionType,
      transactionDate: t.transactionDate,
    })),
    answers: answerRows.map((a) => ({ id: a.id, transactionId: a.transactionId, answerText: a.answerText })),
    facts,
  };
}

export async function loadIndependenceResolver(
  db: typeof Db,
  investorId: string,
  answers?: readonly IndependenceAnswer[]
): Promise<EvidenceIndependenceResolver> {
  return createIndependenceResolver(await loadIndependenceContext(db, investorId, answers));
}
