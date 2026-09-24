import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { listOpenReentryConditions, resolveReentryCondition } from "@/db/repositories/decisions";
import { PredictionAlreadyResolvedError, PredictionNotFoundError, PredictionNotReentryConditionError } from "@/db/errors";

// Decision Follow-Through V1 (docs/architecture.md §2.10) — the re-entry
// condition lifecycle. A condition ("I'd reconsider if X") is the investor's
// own check: they resolve it themselves, on their own time, without a
// Decision Review. No market data is consulted, nothing is pushed — the
// dashboard lists the open conditions as facts (Pull), the investor decides
// whether one fired. Forecasts are not resolvable here.
export const predictionsRouter = router({
  resolveReentryCondition: protectedProcedure
    .input(
      z.object({
        predictionId: z.string().uuid(),
        status: z.enum(["confirmed", "refuted", "inconclusive"]),
        note: z.string().trim().min(1).max(4000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await resolveReentryCondition(db, { investorId: ctx.investorId, predictionId: input.predictionId, status: input.status, note: input.note });
      } catch (err) {
        if (err instanceof PredictionNotFoundError) throw new TRPCError({ code: "NOT_FOUND", message: "Prediction not found." });
        if (err instanceof PredictionNotReentryConditionError) throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        if (err instanceof PredictionAlreadyResolvedError) throw new TRPCError({ code: "CONFLICT", message: err.message });
        throw err;
      }
    }),

  openReentryConditions: protectedProcedure.query(({ ctx }) => listOpenReentryConditions(db, ctx.investorId)),
});
