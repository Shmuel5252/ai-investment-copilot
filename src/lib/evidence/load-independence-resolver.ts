import type { db as Db } from "@/db/client";
import { getAllAnswersForInvestor } from "@/db/repositories/interview";
import { listDecisionsForInvestor } from "@/db/repositories/decisions";
import { loadEffectiveExecutionFactsForInvestor } from "@/db/repositories/execution-facts";
import { resolveDecisionCases } from "./decision-cases";
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
// Evidence Reach V1: the investor's decisions enter with their OD-2 case
// resolution (src/lib/evidence/decision-cases.ts), computed here from the
// persisted decisions, transactions and EFFECTIVE execution facts only —
// never from candidates, proximity or intent.
//
// Callers that already fetched the investor's current answers (dna.generate,
// strategy.generateObserved) pass them in to avoid a second read.
export async function loadIndependenceContext(
  db: typeof Db,
  investorId: string,
  answers?: readonly IndependenceAnswer[]
): Promise<IndependenceContext> {
  const [positions, transactionRows, facts, answerRows, decisionRows, executionFacts] = await Promise.all([
    computePositionsForInvestor(db, investorId),
    listTransactionsForInvestor(db, investorId),
    loadEffectiveLinkFacts(db, investorId),
    answers ?? getAllAnswersForInvestor(db, investorId),
    listDecisionsForInvestor(db, investorId),
    loadEffectiveExecutionFactsForInvestor(db, investorId),
  ]);

  const caseResolutions = resolveDecisionCases(
    decisionRows.map((d) => ({ id: d.id, ticker: d.ticker, decisionType: d.decisionType, decisionDate: d.decisionDate })),
    transactionRows.map((t) => ({ id: t.id, ticker: t.ticker, transactionType: t.transactionType, transactionDate: t.transactionDate })),
    executionFacts
  );

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
    decisions: decisionRows.map((d) => ({ id: d.id, caseResolution: caseResolutions.get(d.id)! })),
  };
}

export async function loadIndependenceResolver(
  db: typeof Db,
  investorId: string,
  answers?: readonly IndependenceAnswer[]
): Promise<EvidenceIndependenceResolver> {
  return createIndependenceResolver(await loadIndependenceContext(db, investorId, answers));
}
