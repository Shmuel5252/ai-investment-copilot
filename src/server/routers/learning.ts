import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { listReviewedDecisionsForInvestor, getLaterContextsForDecision } from "@/db/repositories/decisions";
import {
  insertLearningInsightWithEvidence,
  listLearningInsightsForInvestor,
  getLearningInsight,
  getLatestLearningInsightVersion,
} from "@/db/repositories/learning";
import { getEvidenceForLearningInsight } from "@/db/repositories/evidence";
import { insertDnaHypothesisFromLearningInsight } from "@/db/repositories/dna";
import { insertCorrection, markCorrectionResolved } from "@/db/repositories/corrections";
import { groupReviewedDecisionsBySector, type ReviewedDecisionInput } from "@/lib/learning/group-decisions";
import { computeDecisionQualityPattern, computeThesisAccuracyPattern } from "@/lib/learning/pattern-aggregation";
import { proposeLearningInsight } from "@/lib/ai/learning";
import { validateLearningInsightEvidence } from "@/lib/learning/validate-insight-evidence";
import type { DecisionQuality } from "@/lib/review/decision-quality";
import type { ThesisAccuracy } from "@/lib/learning/pattern-aggregation";
import type { DecisionOutcome } from "@/lib/review/decision-outcome";

interface FrozenCaseSnapshotSector {
  marketIntelligenceJson?: { sector?: string | null } | null;
}

interface RichDecision extends ReviewedDecisionInput {
  decisionType: string;
  decisionDate: string;
  decisionQualityOverall: DecisionQuality;
  thesisAccuracy: ThesisAccuracy;
  outcomeSummary: string;
  narrativeSummaryText: string;
  laterContexts: string[];
}

function formatOutcomeSummary(outcome: DecisionOutcome): string {
  const parts = [
    outcome.priceChangePercent !== null
      ? `price ${outcome.priceChangePercent >= 0 ? "+" : ""}${outcome.priceChangePercent.toFixed(1)}% since decision`
      : "price change unavailable",
  ];
  if (outcome.pnlUsd !== null) parts.push(`P&L $${outcome.pnlUsd.toFixed(2)} (${outcome.pnlPercent?.toFixed(1)}%)`);
  parts.push(outcome.stillHeld ? "still held" : "not currently held");
  return parts.join(", ");
}

export const learningRouter = router({
  // Groups reviewed decisions by sector (code), synthesizes a candidate
  // pattern per qualifying family (AI, cited by real DecisionReview id),
  // validates citations and computes evidenceStrength (code, same
  // threshold table as DNA) before writing anything
  // (docs/architecture.md §2.8).
  generate: protectedProcedure.mutation(async ({ ctx }) => {
    const reviewedDecisions = await listReviewedDecisionsForInvestor(db, ctx.investorId);

    // Fetched per decision, not just hoped to survive into
    // narrativeSummaryText: a decision can be flagged via Later Context
    // as a deliberate non-representative test (real case: a decision
    // recorded specifically to test system behavior, not a genuine
    // thesis) — that must reliably reach the AI call that asserts a
    // behavioral pattern, not depend on whether a prior Review's 2-4
    // sentence summary happened to mention it.
    const laterContextsByDecision = new Map(
      await Promise.all(
        reviewedDecisions.map(
          async (d) => [d.id, (await getLaterContextsForDecision(db, d.id)).map((lc) => lc.text)] as const
        )
      )
    );

    const richDecisions: RichDecision[] = reviewedDecisions.map((d) => {
      const review = d.reviews[0]!;
      const caseSnapshot = (d.snapshot!.investmentCaseSnapshotJson ?? {}) as FrozenCaseSnapshotSector;
      return {
        decisionId: d.id,
        decisionReviewId: review.id,
        ticker: d.ticker,
        sector: caseSnapshot.marketIntelligenceJson?.sector ?? null,
        decisionType: d.decisionType,
        decisionDate: d.decisionDate.toISOString(),
        decisionQualityOverall: review.decisionQualityOverall,
        thesisAccuracy: review.thesisAccuracy,
        outcomeSummary: formatOutcomeSummary(review.outcomeJson as DecisionOutcome),
        narrativeSummaryText: review.narrativeSummaryText,
        laterContexts: laterContextsByDecision.get(d.id) ?? [],
      };
    });

    const families = groupReviewedDecisionsBySector(richDecisions);

    const created = [];
    for (const family of families) {
      const proposed = await proposeLearningInsight(
        family.family,
        family.decisions.map((d) => ({
          decisionReviewId: d.decisionReviewId,
          ticker: d.ticker,
          decisionType: d.decisionType,
          decisionDate: d.decisionDate,
          decisionQualityOverall: d.decisionQualityOverall,
          thesisAccuracy: d.thesisAccuracy,
          outcomeSummary: d.outcomeSummary,
          narrativeSummaryText: d.narrativeSummaryText,
          laterContexts: d.laterContexts,
        }))
      );

      // Same real-gap fix as dna.ts/strategy.ts: dedupe by underlying
      // Decision, not raw review id, before it feeds evidenceStrength —
      // matters if a decision is ever re-reviewed and both reviews end
      // up candidates (listReviewedDecisionsForInvestor already prevents
      // that today by keeping only the latest per decision, but the
      // counting is correct by construction either way).
      const reviewCaseKeys = new Map(family.decisions.map((d) => [d.decisionReviewId, d.decisionId]));
      const validated = validateLearningInsightEvidence(proposed, reviewCaseKeys);
      if (!validated) continue;

      created.push(
        await insertLearningInsightWithEvidence(db, ctx.investorId, family.family, validated, {
          decisionQualityPattern: computeDecisionQualityPattern(family.decisions),
          thesisAccuracyPattern: computeThesisAccuracyPattern(family.decisions),
        })
      );
    }

    return {
      familiesConsidered: families.length,
      createdCount: created.length,
      droppedCount: families.length - created.length,
      insights: created,
    };
  }),

  list: protectedProcedure.query(({ ctx }) => listLearningInsightsForInvestor(db, ctx.investorId)),

  evidence: protectedProcedure
    .input(z.object({ learningInsightId: z.string().uuid() }))
    .query(({ input }) => getEvidenceForLearningInsight(db, input.learningInsightId)),

  // "סגירת הלולאה ל-DNA" (docs/data-model.md §8): agreeing creates a new
  // DNA hypothesis whose evidence sources back to this insight, and
  // records the agreement itself as a resolved Correction — the
  // documented mechanism, not a shortcut around it.
  agree: protectedProcedure
    .input(z.object({ learningInsightId: z.string().uuid(), note: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const insight = await getLearningInsight(db, input.learningInsightId);
      if (!insight || insight.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Learning insight not found." });
      }
      const latestVersion = await getLatestLearningInsightVersion(db, insight.id);
      if (!latestVersion) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This insight has no version to agree with." });
      }

      const pendingCorrection = await insertCorrection(db, {
        learningInsightId: insight.id,
        userArgumentText: input.note,
      });
      const { hypothesis, version } = await insertDnaHypothesisFromLearningInsight(
        db,
        ctx.investorId,
        insight.id,
        latestVersion.statementText
      );
      const correction = await markCorrectionResolved(db, pendingCorrection.id, {
        status: "led_to_new_version",
        resultingVersionId: version.id,
      });

      return { correction, hypothesis, version };
    }),

  disagree: protectedProcedure
    .input(z.object({ learningInsightId: z.string().uuid(), note: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const insight = await getLearningInsight(db, input.learningInsightId);
      if (!insight || insight.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Learning insight not found." });
      }

      const pendingCorrection = await insertCorrection(db, {
        learningInsightId: insight.id,
        userArgumentText: input.note,
      });
      return markCorrectionResolved(db, pendingCorrection.id, { status: "noted" });
    }),
});
