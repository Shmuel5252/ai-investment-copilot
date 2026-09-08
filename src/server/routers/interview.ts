import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import {
  listTransactionsForInvestor,
  listPortfolioOpeningStatesForInvestor,
  getTransaction,
} from "@/db/repositories/portfolio";
import {
  insertInterviewSession,
  insertInterviewAnswer,
  completeInterviewSession,
  getAnswersForSession,
} from "@/db/repositories/interview";
import { selectInterestingTransactions } from "@/lib/interview/select-transactions";
import { buildTellMeWhyQuestion } from "@/lib/interview/tell-me-why-question";
import { describeTransactionFacts, generateInterviewQuestion } from "@/lib/ai/interview";

export const interviewRouter = router({
  // Selects a sample of transactions (code) and generates one question
  // per transaction (AI, over facts computed in code) — see
  // docs/architecture.md §2.2. Questions are NOT persisted here: an
  // InterviewAnswer row only exists once question+answer are both known
  // (docs/data-model.md §9), so the in-flight question set just lives in
  // the response until the client submits answers.
  start: protectedProcedure.mutation(async ({ ctx }) => {
    const [transactions, openingStates] = await Promise.all([
      listTransactionsForInvestor(db, ctx.investorId),
      listPortfolioOpeningStatesForInvestor(db, ctx.investorId),
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

  answer: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        transactionId: z.string().uuid(),
        questionText: z.string().min(1),
        answerText: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      return insertInterviewAnswer(db, {
        interviewSessionId: input.sessionId,
        transactionId: input.transactionId,
        questionText: input.questionText,
        answerText: input.answerText,
      });
    }),

  complete: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await completeInterviewSession(db, input.sessionId);
      return { ok: true };
    }),

  // "Tell me why" (docs/backlog.md) — user-initiated, separate from the
  // guided/algorithmic flow above. Contract (Product decision,
  // 2026-09-08 — explicitly replaces an earlier same-batch-only
  // decision): available for ANY transaction the investor owns with
  // source="manual_entry" — no time limit, no batch identifier, checked
  // by the two guards right below (ownership, then source). The client
  // does not enforce any scope here anymore: src/app/import/page.tsx
  // currently only renders the "Tell me why" button right after a
  // manual-entry submit because there's no "all my manual transactions"
  // history screen yet to surface it from elsewhere — that's a UI gap,
  // not a limit on this endpoint's actual contract. The question is
  // deterministic code, not AI (buildTellMeWhyQuestion — no Anthropic
  // import in that file at all). Deliberately does NOT reuse `start`
  // above: that mutation always re-selects from the investor's *entire*
  // transaction history via selectInterestingTransactions with
  // maxCount=6 — wrong shape entirely for "ask about this one specific
  // transaction the investor chose." Saving the answer reuses the
  // existing `answer` mutation above unchanged; so does `complete`.
  startTellMeWhy: protectedProcedure
    .input(z.object({ transactionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const transaction = await getTransaction(db, input.transactionId);
      if (!transaction || transaction.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found." });
      }
      if (transaction.source !== "manual_entry") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "\"Tell me why\" is only available for a transaction you entered manually (not one imported from a file).",
        });
      }
      if (!transaction.ticker) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This transaction has no ticker to ask about.",
        });
      }

      const session = await insertInterviewSession(db, {
        investorId: ctx.investorId,
        origin: "user_initiated",
      });

      return {
        sessionId: session.id,
        transactionId: transaction.id,
        ticker: transaction.ticker,
        questionText: buildTellMeWhyQuestion(transaction.ticker),
      };
    }),

  answersForSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ input }) => getAnswersForSession(db, input.sessionId)),
});
