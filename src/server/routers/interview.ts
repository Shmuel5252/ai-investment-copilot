import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import {
  listTransactionsForInvestor,
  listPortfolioOpeningStatesForInvestor,
  getTransaction,
} from "@/db/repositories/portfolio";
import { listCorporateActionsForInvestor } from "@/db/repositories/corporate-actions";
import {
  insertInterviewSession,
  insertInterviewAnswer,
  completeInterviewSession,
  getAnswersForSession,
  getInterviewSession,
  insertSupersedingInterviewAnswer,
} from "@/db/repositories/interview";
import { loadEpisodeJournal as loadEpisodeJournalFor } from "@/lib/portfolio/load-episode-journal";
import { resolveTellMeWhyAnchor, toHindsightSafeJournal } from "@/lib/interview/journal";
import { selectInterestingTransactions } from "@/lib/interview/select-transactions";
import { buildTellMeWhyQuestion } from "@/lib/interview/tell-me-why-question";
import { describeTransactionFacts, generateInterviewQuestion } from "@/lib/ai/interview";

// Episode Journal V1 — the derived journal over the investor's whole
// position history (src/lib/portfolio/episodes.ts). Episode membership is
// computePositionsForInvestor()'s own map — the exact same one the Decision
// Independence resolver counts evidence by (loadIndependenceContext) — and
// coverage is computed from getAllAnswersForInvestor, the exact reader
// dna.generate / strategy.generateObserved consume, so "covered" means
// "will be seen by generation". Read-only; nothing is stored.
// (The loader itself now lives in src/lib/portfolio/load-episode-journal.ts,
// shared with the Prior Record Brief — one derivation path, unchanged.)
const loadEpisodeJournal = (investorId: string) => loadEpisodeJournalFor(db, investorId);

async function requireOwnedSession(investorId: string, sessionId: string) {
  const session = await getInterviewSession(db, sessionId);
  if (!session || session.investorId !== investorId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Interview session not found." });
  }
  return session;
}

export const interviewRouter = router({
  // Selects a sample of transactions (code) and generates one question
  // per transaction (AI, over facts computed in code) — see
  // docs/architecture.md §2.2. Questions are NOT persisted here: an
  // InterviewAnswer row only exists once question+answer are both known
  // (docs/data-model.md §9), so the in-flight question set just lives in
  // the response until the client submits answers.
  start: protectedProcedure.mutation(async ({ ctx }) => {
    const [transactions, openingStates, corporateActions] = await Promise.all([
      listTransactionsForInvestor(db, ctx.investorId),
      listPortfolioOpeningStatesForInvestor(db, ctx.investorId),
      listCorporateActionsForInvestor(db, ctx.investorId),
    ]);
    const candidates = selectInterestingTransactions(
      transactions.map((t) => ({
        id: t.id,
        ticker: t.ticker,
        transactionType: t.transactionType,
        quantity: t.quantity === null ? null : Number(t.quantity),
        price: t.price === null ? null : Number(t.price),
        amount: Number(t.amount),
        transactionDate: t.transactionDate,
      })),
      openingStates.map((o) => ({
        ticker: o.ticker,
        quantity: Number(o.quantity),
        costBasisPerShare: o.costBasisPerShare === null ? null : Number(o.costBasisPerShare),
        costBasisConfidence: o.costBasisConfidence,
        asOfDate: o.asOfDate,
      })),
      undefined,
      // The recorded splits (Import Blockers V1) — the same input the
      // computePositionsForInvestor() wrapper gives every other consumer.
      corporateActions.map((a) => ({
        ticker: a.ticker,
        effectiveDate: a.effectiveDate,
        ratioNumerator: a.ratioNumerator,
        ratioDenominator: a.ratioDenominator,
      }))
    );

    if (candidates.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No trade history found yet — import your trade history first.",
      });
    }

    const session = await insertInterviewSession(db, {
      investorId: ctx.investorId,
      origin: "guided_interview",
    });

    const questions = await Promise.all(
      candidates.map(async (candidate) => ({
        transactionId: candidate.transaction.id,
        ticker: candidate.transaction.ticker,
        category: candidate.category,
        facts: describeTransactionFacts(candidate),
        questionText: await generateInterviewQuestion(candidate),
      }))
    );

    return { sessionId: session.id, questions };
  }),

  // Append-only (docs/data-model.md §0/§9): a new row every time. A
  // correction/update of an earlier answer is a NEW row whose
  // supersedesAnswerId points at the old one — the old text is never
  // touched, and getAllAnswersForInvestor simply stops returning it. The
  // session and any superseded answer must belong to this investor; an
  // answer can be superseded at most once (a chain, never a fork).
  answer: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        transactionId: z.string().uuid(),
        questionText: z.string().min(1),
        answerText: z.string().min(1),
        supersedesAnswerId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwnedSession(ctx.investorId, input.sessionId);
      // The anchor must be this investor's own transaction — an answer can
      // never point at a row it does not own (the guided interview and the
      // journal only ever hand back owned ids; this closes the raw API).
      const anchor = await getTransaction(db, input.transactionId);
      if (!anchor || anchor.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found." });
      }
      const values = {
        interviewSessionId: input.sessionId,
        transactionId: input.transactionId,
        questionText: input.questionText,
        answerText: input.answerText,
      };
      if (input.supersedesAnswerId === undefined) return insertInterviewAnswer(db, values);

      // Ownership of the superseded answer and the one-successor rule are
      // checked under a row lock inside the repository, so a concurrent
      // double update cannot fork the chain.
      const result = await insertSupersedingInterviewAnswer(db, ctx.investorId, {
        ...values,
        supersedesAnswerId: input.supersedesAnswerId,
      });
      if (!result.ok) {
        if (result.reason === "not_found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "The answer being updated was not found." });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That answer has already been updated once — update its latest version instead.",
        });
      }
      return result.row;
    }),

  complete: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireOwnedSession(ctx.investorId, input.sessionId);
      await completeInterviewSession(db, input.sessionId);
      return { ok: true };
    }),

  // "Tell me why" — user-initiated, separate from the guided/algorithmic
  // flow above. Contract (Product decision, Episode Journal V1, 2026-09-22
  // — explicitly replaces the 2026-09-08 manual-entry-only contract):
  // available for ANY buy/sell transaction the investor owns that has a
  // ticker, whatever its source, whichever transaction of the episode was
  // chosen. The rationale is persisted against ONE deterministic anchor —
  // the episode's entry BUY (src/lib/portfolio/episodes.ts) — so the
  // returned `transactionId` is that anchor, not necessarily the one the
  // investor clicked; `requestedTransactionId` echoes the click. An episode
  // with no BUY (opened before the imported window) fails closed here. The
  // question is deterministic code, not AI (buildTellMeWhyQuestion), and by
  // construction carries only entry-time facts — never realized P&L, exit
  // or later prices (hindsight protection). Deliberately does NOT reuse
  // `start`: that re-selects from the whole history with maxCount=6 — the
  // wrong shape for "ask about the episode the investor chose". Saving
  // reuses `answer`/`complete` above.
  startTellMeWhy: protectedProcedure
    .input(z.object({ transactionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const transaction = await getTransaction(db, input.transactionId);
      if (!transaction || transaction.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found." });
      }
      if (transaction.transactionType !== "buy" && transaction.transactionType !== "sell") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "\"Tell me why\" is only available for a buy or sell — not a dividend, fee, deposit or withdrawal.",
        });
      }
      if (!transaction.ticker) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This transaction has no ticker to ask about.",
        });
      }

      const journal = await loadEpisodeJournal(ctx.investorId);
      const anchor = resolveTellMeWhyAnchor(journal, transaction.id);
      if (!anchor.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            anchor.reason === "no_entry_anchor"
              ? "This position has no buy in the imported history (it was probably opened before the import window), so there is no decision to anchor a rationale to."
              : "This transaction does not belong to any investment episode.",
        });
      }

      const session = await insertInterviewSession(db, {
        investorId: ctx.investorId,
        origin: "user_initiated",
      });
      const { episode } = anchor;

      return {
        sessionId: session.id,
        transactionId: anchor.anchorTransactionId,
        requestedTransactionId: transaction.id,
        ticker: episode.ticker,
        episodeKey: episode.key,
        episodeStatus: episode.status,
        questionText: buildTellMeWhyQuestion({
          ticker: episode.ticker,
          episodeNumber: episode.episodeNumber,
          status: episode.status,
          entry: episode.entry,
        }),
      };
    }),

  // The hindsight-safe journal (src/lib/interview/journal.ts): later/outcome
  // facts are omitted server-side for every episode without a rationale.
  journal: protectedProcedure.query(async ({ ctx }) => toHindsightSafeJournal(await loadEpisodeJournal(ctx.investorId))),

  journalCoverage: protectedProcedure.query(async ({ ctx }) => (await loadEpisodeJournal(ctx.investorId)).coverage),

  answersForSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireOwnedSession(ctx.investorId, input.sessionId);
      return getAnswersForSession(db, input.sessionId);
    }),
});
