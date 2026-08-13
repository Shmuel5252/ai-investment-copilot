import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { getAllAnswersForInvestor } from "@/db/repositories/interview";
import {
  listActiveDnaHypothesesForInvestor,
  insertDnaHypothesisWithEvidence,
  setDnaHypothesisStatus,
} from "@/db/repositories/dna";
import { getEvidenceForDnaHypothesis } from "@/db/repositories/evidence";
import { proposeDnaHypotheses } from "@/lib/ai/dna";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";

export const dnaRouter = router({
  // AI proposes hypotheses + evidence citations from InterviewAnswers
  // (docs/architecture.md §2.3); code validates every citation against
  // real rows before anything is written, and always computes
  // evidenceStrength itself (never trusts a number from the model).
  generate: protectedProcedure.mutation(async ({ ctx }) => {
    const answers = await getAllAnswersForInvestor(db, ctx.investorId);
    if (answers.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No interview answers found yet — complete the onboarding interview first.",
      });
    }

    const proposed = await proposeDnaHypotheses(
      answers.map((a) => ({ id: a.id, questionText: a.questionText, answerText: a.answerText }))
    );

    const validAnswerIds = new Set(answers.map((a) => a.id));
    const validated = validateProposedHypotheses(proposed, validAnswerIds);

    const created = [];
    for (const hypothesis of validated) {
      created.push(await insertDnaHypothesisWithEvidence(db, ctx.investorId, hypothesis));
    }

    return {
      proposedCount: proposed.length,
      createdCount: created.length,
      droppedCount: proposed.length - created.length,
      hypotheses: created,
    };
  }),

  list: protectedProcedure.query(({ ctx }) => listActiveDnaHypothesesForInvestor(db, ctx.investorId)),

  evidence: protectedProcedure
    .input(z.object({ dnaHypothesisId: z.string().uuid() }))
    .query(({ input }) => getEvidenceForDnaHypothesis(db, input.dnaHypothesisId)),

  // "View Evidence and an option for me to correct, add context, or
  // disagree" (concept doc §4) — the simplest form of disagreement:
  // stop surfacing this hypothesis as active. It is not deleted
  // (docs/data-model.md: DNAHypothesis identity rows aren't in the
  // immutable list, but nothing about disagreement should erase the
  // version history either) — just no longer shown as an active belief.
  reject: protectedProcedure
    .input(z.object({ dnaHypothesisId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await setDnaHypothesisStatus(db, input.dnaHypothesisId, "user_rejected");
      return { ok: true };
    }),
});
