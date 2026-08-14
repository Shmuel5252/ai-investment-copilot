import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import {
  insertIdea,
  listIdeasForInvestor,
  getIdea,
  markIdeaPromoted,
  insertInvestmentCase,
} from "@/db/repositories/ideas-cases";

export const ideasRouter = router({
  // "משתמש: יוצר Idea קצר או Case ישירות" (docs/architecture.md §2.5) —
  // Idea is the short/lightweight path; cases.create is the direct path.
  create: protectedProcedure
    .input(z.object({ ticker: z.string().min(1), noteText: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      insertIdea(db, {
        investorId: ctx.investorId,
        ticker: input.ticker.trim().toUpperCase(),
        noteText: input.noteText,
      })
    ),

  list: protectedProcedure.query(({ ctx }) => listIdeasForInvestor(db, ctx.investorId)),

  // Turns an Idea into a real InvestmentCase to research further. The
  // Idea's own note carries over as context (used later by AI synthesis)
  // — nothing about the Idea itself changes except recording which case
  // it became (Idea is Mutable, docs/data-model.md §10).
  promote: protectedProcedure
    .input(z.object({ ideaId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const idea = await getIdea(db, input.ideaId);
      if (!idea || idea.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found." });
      }

      const investmentCase = await insertInvestmentCase(db, {
        investorId: ctx.investorId,
        ticker: idea.ticker,
        ideaId: idea.id,
      });
      await markIdeaPromoted(db, idea.id, investmentCase.id);
      return investmentCase;
    }),
});
