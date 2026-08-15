import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import {
  getDecision,
  getDecisionSnapshotByDecisionId,
  getPredictionsForThesis,
  insertDecisionReview,
  getDecisionReviewsForDecision,
  resolvePrediction,
} from "@/db/repositories/decisions";
import { getStrategyVersionPrinciples } from "@/db/repositories/strategy";
import { getMarketContextById } from "@/db/repositories/market-context";
import { insertCorrection } from "@/db/repositories/corrections";
import { getMarketIntelligence } from "@/lib/market/market-intelligence";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";
import { computeDecisionOutcome } from "@/lib/review/decision-outcome";
import { calculateDecisionQualityOverall } from "@/lib/review/decision-quality";
import { validateReviewDimensions } from "@/lib/review/validate-review-dimensions";
import { synthesizeDecisionReview } from "@/lib/ai/review";
import type { MarketIntelligence } from "@/lib/market/fmp";

interface FrozenCaseSnapshot {
  marketIntelligenceJson?: MarketIntelligence | null;
  bullCaseText?: string | null;
  bearCaseText?: string | null;
  catalystsText?: string | null;
  invalidationConditionsText?: string | null;
  marketBlindspotText?: string | null;
  devilsAdvocateText?: string | null;
  personalFitText?: string | null;
  portfolioFitText?: string | null;
}

interface FrozenPortfolioState {
  cash: number;
  positions: { ticker: string; quantity: number }[];
}

async function requireOwnedDecision(investorId: string, decisionId: string) {
  const decision = await getDecision(db, decisionId);
  if (!decision || decision.investorId !== investorId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Decision not found." });
  }
  return decision;
}

export const reviewsRouter = router({
  // Predictions extracted from this decision's Thesis that still need the
  // investor's own resolution before a review can synthesize Thesis
  // Accuracy from them (docs/data-model.md §5: AI is only ever "supported
  // by" resolutions, never the one deciding whether a claim came true).
  pendingPredictions: protectedProcedure
    .input(z.object({ decisionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const decision = await requireOwnedDecision(ctx.investorId, input.decisionId);
      const snapshot = await getDecisionSnapshotByDecisionId(db, decision.id);
      if (!snapshot) return [];
      const predictions = await getPredictionsForThesis(db, snapshot.thesisId);
      return predictions.filter((p) => p.status === "pending");
    }),

  listForDecision: protectedProcedure
    .input(z.object({ decisionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const decision = await requireOwnedDecision(ctx.investorId, input.decisionId);
      return getDecisionReviewsForDecision(db, decision.id);
    }),

  // Gathers and validates everything (fresh Outcome, current market data,
  // the Strategy/DNA versions frozen into the snapshot, user-resolved
  // predictions) before any write — a DecisionReview without its 7
  // dimensions would be a half-written judgment (insertDecisionReview
  // already bundles them atomically). decision_quality_overall is always
  // the deterministic rollup of the validated verdicts, never taken from
  // the AI directly.
  generate: protectedProcedure
    .input(
      z.object({
        decisionId: z.string().uuid(),
        predictionResolutions: z
          .array(
            z.object({
              predictionId: z.string().uuid(),
              status: z.enum(["confirmed", "refuted", "inconclusive"]),
              note: z.string().min(1),
            })
          )
          .default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const decision = await requireOwnedDecision(ctx.investorId, input.decisionId);
      const snapshot = await getDecisionSnapshotByDecisionId(db, decision.id);
      if (!snapshot) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This decision has no snapshot to review." });
      }

      const allPredictions = await getPredictionsForThesis(db, snapshot.thesisId);
      const resolutionByPredictionId = new Map(input.predictionResolutions.map((r) => [r.predictionId, r]));
      const stillUnresolved = allPredictions.filter(
        (p) => p.status === "pending" && !resolutionByPredictionId.has(p.id)
      );
      if (stillUnresolved.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Resolve ${stillUnresolved.length} pending prediction(s) first.`,
        });
      }
      for (const r of input.predictionResolutions) {
        const p = allPredictions.find((x) => x.id === r.predictionId);
        if (!p || p.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A resolved prediction doesn't match a real pending prediction on this decision.",
          });
        }
      }

      const predictionsWithResolutions = allPredictions.map((p) => {
        const newRes = resolutionByPredictionId.get(p.id);
        return newRes
          ? { claimText: p.claimText, status: newRes.status, resolutionNote: newRes.note }
          : { claimText: p.claimText, status: p.status, resolutionNote: p.resolutionNote };
      });

      const caseSnapshot = (snapshot.investmentCaseSnapshotJson ?? {}) as FrozenCaseSnapshot;
      const bundledPrincipleRows = await getStrategyVersionPrinciples(db, snapshot.strategyVersionId);
      const strategyPrinciplesInEffect = bundledPrincipleRows.map((row) => ({
        statementText: row.principleVersion.statementText,
        principleType: row.principleVersion.principleType,
      }));
      const dnaHypothesesInEffect = snapshot.dnaReferences.map((ref) => ({
        statementText: ref.dnaHypothesisVersion.statementText,
        evidenceStrength: ref.dnaHypothesisVersion.evidenceStrength,
      }));
      const marketContext = await getMarketContextById(db, snapshot.marketContextId);

      // Outcome — code only (docs/architecture.md §2.7). Not gated behind
      // "explicit request" here: computing it is neutral; whether the UI
      // shows it by default (for an actual BUY/ADD/HOLD/REDUCE/SELL) or
      // behind a "show what happened since" click (for a PASS, where this
      // number literally *is* the counterfactual) is a display decision
      // made in src/app/decisions/[id]/page.tsx, not here.
      const [currentIntelligence, currentPortfolio] = await Promise.all([
        getMarketIntelligence(db, decision.ticker).catch(() => null),
        computePositionsForInvestor(db, ctx.investorId),
      ]);
      const currentPosition = currentPortfolio.positions.find((p) => p.ticker === decision.ticker);
      const outcome = computeDecisionOutcome({
        priceAtDecision: Number(snapshot.priceAtDecision),
        sizeDollars: snapshot.size !== null ? Number(snapshot.size) : null,
        currentPrice: currentIntelligence?.price ?? null,
        currentlyHeldQuantity: currentPosition?.quantity ?? 0,
        asOfDate: new Date(),
      });

      const proposed = await synthesizeDecisionReview({
        ticker: decision.ticker,
        decisionType: decision.decisionType,
        decisionDate: decision.decisionDate.toISOString(),
        priceAtDecision: Number(snapshot.priceAtDecision),
        sizeDollars: snapshot.size !== null ? Number(snapshot.size) : null,
        userReasoningText: snapshot.userReasoningText,
        risksConsideredText: snapshot.risksConsideredText,
        exitConditionsText: snapshot.exitConditionsText,
        aiRealtimeAssessmentText: snapshot.aiRealtimeAssessmentText,
        thesisText: snapshot.thesis?.thesisText ?? "",
        thesisInterpretationText: snapshot.thesis?.aiInterpretationText ?? null,
        portfolioStateAtDecision: snapshot.portfolioStateJson as FrozenPortfolioState,
        marketContextAtDecision: {
          indexLevel: marketContext ? Number(marketContext.indexLevel) : null,
          indexChange1d: marketContext ? Number(marketContext.indexChange1d) : null,
          volatilityIndexValue:
            marketContext?.volatilityIndexValue != null ? Number(marketContext.volatilityIndexValue) : null,
        },
        caseMarketIntelligenceSummary: JSON.stringify(caseSnapshot.marketIntelligenceJson ?? {}),
        caseBullCaseText: caseSnapshot.bullCaseText ?? null,
        caseBearCaseText: caseSnapshot.bearCaseText ?? null,
        caseCatalystsText: caseSnapshot.catalystsText ?? null,
        caseInvalidationConditionsText: caseSnapshot.invalidationConditionsText ?? null,
        caseMarketBlindspotText: caseSnapshot.marketBlindspotText ?? null,
        caseDevilsAdvocateText: caseSnapshot.devilsAdvocateText ?? null,
        casePersonalFitText: caseSnapshot.personalFitText ?? null,
        casePortfolioFitText: caseSnapshot.portfolioFitText ?? null,
        strategyPrinciplesInEffect,
        dnaHypothesesInEffect,
        predictionsWithResolutions,
        outcome,
      });

      const validatedDimensions = validateReviewDimensions(proposed.dimensions);
      const decisionQualityOverall = calculateDecisionQualityOverall(validatedDimensions.map((d) => d.verdict));

      const review = await insertDecisionReview(
        db,
        {
          decisionId: decision.id,
          narrativeSummaryText: proposed.narrativeSummaryText,
          decisionQualityOverall,
          thesisAccuracy: proposed.thesisAccuracy,
          outcomeJson: outcome,
        },
        validatedDimensions.map((d) => ({
          dimension: d.dimension,
          verdict: d.verdict,
          rationaleText: d.rationaleText,
          citedSnapshotFields: d.citedSnapshotFields,
        }))
      );

      for (const r of input.predictionResolutions) {
        await resolvePrediction(db, r.predictionId, {
          status: r.status,
          resolvedByReviewId: review.id,
          resolutionNote: r.note,
        });
      }

      return { review, dimensions: validatedDimensions };
    }),

  // Generic appeal (docs/architecture.md §2.7: "יכול לערער (Correction,
  // לא דורס)") — stored immutably, never overwrites the ReviewDimension
  // or DecisionReview it targets. Acting on an accepted correction (a new
  // Review incorporating it) is a future extension, not required by this
  // task's Done bar — the schema/repository already support it
  // (markCorrectionResolved), this just wires up submission.
  correct: protectedProcedure
    .input(
      z
        .object({
          reviewDimensionId: z.string().uuid().optional(),
          decisionReviewId: z.string().uuid().optional(),
          userArgumentText: z.string().min(1),
        })
        .refine((v) => !!v.reviewDimensionId !== !!v.decisionReviewId, {
          message: "Provide exactly one of reviewDimensionId or decisionReviewId.",
        })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.reviewDimensionId) {
        const dimension = await db.query.reviewDimensions.findFirst({
          where: (rd, { eq }) => eq(rd.id, input.reviewDimensionId!),
          with: { review: { with: { decision: true } } },
        });
        if (!dimension || dimension.review?.decision?.investorId !== ctx.investorId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Review dimension not found." });
        }
      } else {
        const review = await db.query.decisionReviews.findFirst({
          where: (r, { eq }) => eq(r.id, input.decisionReviewId!),
          with: { decision: true },
        });
        if (!review || review.decision?.investorId !== ctx.investorId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Decision review not found." });
        }
      }

      return insertCorrection(db, {
        reviewDimensionId: input.reviewDimensionId,
        decisionReviewId: input.decisionReviewId,
        userArgumentText: input.userArgumentText,
      });
    }),
});
