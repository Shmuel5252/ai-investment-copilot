import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import {
  listTransactionsForInvestor,
  listPortfolioOpeningStatesForInvestor,
} from "@/db/repositories/portfolio";
import {
  insertInterviewSession,
  insertInterviewAnswer,
  completeInterviewSession,
  getAnswersForSession,
} from "@/db/repositories/interview";
import { selectInterestingTransactions } from "@/lib/interview/select-transactions";
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

    const session = await insertInterviewSession(db, { investorId: ctx.investorId });

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

  answersForSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ input }) => getAnswersForSession(db, input.sessionId)),
});
