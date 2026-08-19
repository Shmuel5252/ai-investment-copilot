import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import {
  insertThesis,
  insertDecision,
  insertPrediction,
  insertDecisionSnapshot,
  getDecision,
  getDecisionSnapshotByDecisionId,
  getPredictionsForThesis,
  listDecisionsForInvestor,
  getDecisionByCaseId,
  insertLaterContext,
  getLaterContextsForDecision,
} from "@/db/repositories/decisions";
import { getInvestmentCase, updateInvestmentCase } from "@/db/repositories/ideas-cases";
import { getLatestStrategyVersion, getStrategyVersionPrinciples } from "@/db/repositories/strategy";
import { listActiveDnaHypothesesForInvestor } from "@/db/repositories/dna";
import { getMarketIntelligence } from "@/lib/market/market-intelligence";
import { getOrCaptureMarketContext } from "@/lib/market/market-context";
import { getMarketContextById } from "@/db/repositories/market-context";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";
import { computePortfolioFit } from "@/lib/portfolio/portfolio-fit";
import { synthesizeDecisionContext } from "@/lib/ai/decision";
import { isUniqueViolation } from "@/db/errors";
import { excludeInsufficientEvidence } from "@/lib/dna/evidence-strength";

// Decision types that add exposure — the only ones a hypothetical size
// meaningfully projects onto computePortfolioFit(), which always models
// `sizeDollars` as an addition (src/lib/portfolio/portfolio-fit.ts).
// PASS/HOLD/REDUCE/SELL still get real current-exposure numbers, just
// without a misleading "projected" figure modeled as a further buy.
const ADDITIVE_DECISION_TYPES = new Set(["BUY", "ADD"]);

export const decisionsRouter = router({
  // Freezes everything at once (docs/architecture.md §2.6): current
  // price, portfolio state, market context, the strategy version and
  // DNA hypothesis versions in effect right now, and a frozen copy of
  // the Case content — through one insert, no UPDATE ever again
  // (docs/data-model.md §5, §10). This is the one tRPC mutation in the
  // whole app where "half-written" would corrupt an immutable record,
  // so everything is gathered and validated before the actual DB writes
  // begin.
  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        decisionType: z.enum(["BUY", "PASS", "HOLD", "ADD", "REDUCE", "SELL"]),
        decisionDate: z.string().datetime().optional(),
        sizeDollars: z.number().positive().optional(),
        reasoningText: z.string().min(1),
        risksConsideredText: z.string().optional(),
        exitConditionsText: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const investmentCase = await getInvestmentCase(db, input.caseId);
      if (!investmentCase || investmentCase.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Investment case not found." });
      }
      if (investmentCase.status !== "researching") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This case already has a recorded decision — start a new Idea/Case to decide again.",
        });
      }

      const latestStrategyVersion = await getLatestStrategyVersion(db, ctx.investorId);
      if (!latestStrategyVersion) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Approve a baseline Strategy version first — every Decision Snapshot freezes the Strategy version in effect.",
        });
      }

      // Fresh, not cache-reused — the price a real financial decision
      // gets frozen against should be as current as possible, unlike
      // casual case browsing (docs/architecture.md §2.6 "מחיר... בזמן
      // ההחלטה").
      const intelligence = await getMarketIntelligence(db, investmentCase.ticker, { forceRefresh: true });
      const marketContext = await getOrCaptureMarketContext(db);

      const [portfolioState, bundledPrincipleRows, dnaHypotheses] = await Promise.all([
        computePositionsForInvestor(db, ctx.investorId),
        getStrategyVersionPrinciples(db, latestStrategyVersion.id),
        listActiveDnaHypothesesForInvestor(db, ctx.investorId),
      ]);

      const sizeDollarsForFit = ADDITIVE_DECISION_TYPES.has(input.decisionType) ? input.sizeDollars : undefined;
      const otherTickerPrices: Record<string, number> = {};
      await Promise.all(
        portfolioState.positions
          .filter((p) => p.ticker !== investmentCase.ticker)
          .map(async (p) => {
            try {
              const other = await getMarketIntelligence(db, p.ticker);
              otherTickerPrices[p.ticker] = other.price;
            } catch {
              // Same fallback as computePortfolioFitForInvestor: a
              // market-data hiccup for one other holding shouldn't block
              // recording this decision.
            }
          })
      );
      const portfolioFit = computePortfolioFit(portfolioState, otherTickerPrices, {
        ticker: investmentCase.ticker,
        price: intelligence.price,
        sizeDollars: sizeDollarsForFit,
      });

      // insufficient_evidence hypotheses/principles are excluded from
      // what the AI reasons with (real gap found on real data — a hedge
      // in the prompt alone wasn't enough to stop them leaning the
      // narrative). dnaHypothesisVersionIds below is deliberately NOT
      // filtered — it's what gets frozen into the immutable
      // DecisionSnapshot as "which DNA versions were in effect", a
      // historical fact independent of what informed this one narrative.
      const strategyPrinciplesForAi = excludeInsufficientEvidence(
        bundledPrincipleRows.map((row) => ({
          statementText: row.principleVersion.statementText,
          principleType: row.principleVersion.principleType,
          evidenceStrength: row.principleVersion.evidenceStrength,
        }))
      );
      const dnaHypothesesForAi = excludeInsufficientEvidence(
        dnaHypotheses
          .map((h) => {
            const version = h.versions[0];
            return version ? { statementText: version.statementText, evidenceStrength: version.evidenceStrength } : null;
          })
          .filter((h): h is NonNullable<typeof h> => h !== null)
      );
      const dnaHypothesisVersionIds = dnaHypotheses
        .map((h) => h.versions[0]?.id)
        .filter((id): id is string => !!id);

      const synthesis = await synthesizeDecisionContext({
        ticker: investmentCase.ticker,
        decisionType: input.decisionType,
        sizeDollars: input.sizeDollars,
        reasoningText: input.reasoningText,
        risksConsideredText: input.risksConsideredText,
        exitConditionsText: input.exitConditionsText,
        marketIntelligence: intelligence,
        marketContext: {
          indexLevel: Number(marketContext.indexLevel),
          indexChange1d: Number(marketContext.indexChange1d),
          indexChange1m: marketContext.indexChange1m === null ? null : Number(marketContext.indexChange1m),
          volatilityIndexValue:
            marketContext.volatilityIndexValue === null ? null : Number(marketContext.volatilityIndexValue),
        },
        portfolioFit,
        dnaHypotheses: dnaHypothesesForAi,
        strategyPrinciples: strategyPrinciplesForAi,
      });

      const thesis = await insertThesis(db, {
        thesisText: input.reasoningText,
        aiInterpretationText: synthesis.thesisInterpretationText,
      });

      // The status check above already blocks the normal case; this
      // catches the genuine race variant (two concurrent requests both
      // passing that check before either commits — two tabs, a retried
      // request) that UNIQUE(investment_case_id) exists specifically to
      // prevent at the DB level. Same message either way, since it's the
      // same real-world situation from the user's point of view — a
      // raw 500 with an internal SQL message here would be the one table
      // in the whole app where that's worst, since what it's guarding is
      // a duplicate immutable DecisionSnapshot.
      let decision;
      try {
        decision = await insertDecision(db, {
          investorId: ctx.investorId,
          investmentCaseId: investmentCase.id,
          ticker: investmentCase.ticker,
          decisionType: input.decisionType,
          decisionDate: input.decisionDate ? new Date(input.decisionDate) : new Date(),
        });
      } catch (err) {
        if (isUniqueViolation(err, "decisions_investment_case_id_unique")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This case already has a recorded decision — start a new Idea/Case to decide again.",
          });
        }
        throw err;
      }

      // "today + N days" is computed here, in code, never by the model
      // (CLAUDE.md "AI vs Code": timestamps/time ranges are deterministic
      // facts) — synthesizeDecisionContext only ever returns an estimated
      // day-count, exactly so this arithmetic can't land on a wrong date.
      for (const prediction of synthesis.predictions) {
        await insertPrediction(db, {
          thesisId: thesis.id,
          claimText: prediction.claimText,
          checkableByDate:
            prediction.timeframeDays !== null
              ? new Date(Date.now() + prediction.timeframeDays * 86_400_000)
              : undefined,
        });
      }

      const snapshot = await insertDecisionSnapshot(
        db,
        {
          decisionId: decision.id,
          priceAtDecision: String(intelligence.price),
          size: input.sizeDollars !== undefined ? String(input.sizeDollars) : null,
          userReasoningText: input.reasoningText,
          aiRealtimeAssessmentText: synthesis.realtimeAssessmentText,
          risksConsideredText: input.risksConsideredText,
          exitConditionsText: input.exitConditionsText,
          portfolioStateJson: portfolioState,
          marketContextId: marketContext.id,
          strategyVersionId: latestStrategyVersion.id,
          thesisId: thesis.id,
          investmentCaseSnapshotJson: investmentCase,
        },
        dnaHypothesisVersionIds
      );

      // Slice 1 simplification: one Decision concludes a Case's research
      // phase, whichever decisionType it is (including PASS) — a later
      // reconsideration of the same ticker starts a new Idea/Case rather
      // than reopening this one (docs/data-model.md §10: InvestmentCase
      // is Mutable only "while researching").
      await updateInvestmentCase(db, investmentCase.id, { status: "decided" });

      return { decision, snapshot };
    }),

  get: protectedProcedure
    .input(z.object({ decisionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const decision = await getDecision(db, input.decisionId);
      if (!decision || decision.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Decision not found." });
      }
      const snapshot = await getDecisionSnapshotByDecisionId(db, decision.id);
      if (!snapshot) return { decision, snapshot: null, predictions: [], marketContext: null };

      const [predictions, marketContext] = await Promise.all([
        getPredictionsForThesis(db, snapshot.thesisId),
        getMarketContextById(db, snapshot.marketContextId),
      ]);

      return { decision, snapshot, predictions, marketContext: marketContext ?? null };
    }),

  list: protectedProcedure.query(({ ctx }) => listDecisionsForInvestor(db, ctx.investorId)),

  getForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(({ input }) => getDecisionByCaseId(db, input.caseId)),

  // "אפשר להוסיף הקשר, לא לשנות היסטוריה" — the sanctioned way to
  // correct or clarify an already-immutable Decision Snapshot without
  // rewriting it (docs/CLAUDE.md Historical Integrity flow: Original
  // Snapshot -> Later Context -> Review -> Learning Insight). Real use:
  // a real-time assessment or extracted Prediction turned out to contain
  // an AI error (e.g. confusing position size with per-share price) —
  // this records the correction as a new, separate, timestamped fact
  // rather than editing the frozen original text.
  addLaterContext: protectedProcedure
    .input(z.object({ decisionId: z.string().uuid(), text: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const decision = await getDecision(db, input.decisionId);
      if (!decision || decision.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Decision not found." });
      }
      return insertLaterContext(db, { decisionId: decision.id, text: input.text, addedBy: "user" });
    }),

  listLaterContext: protectedProcedure
    .input(z.object({ decisionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const decision = await getDecision(db, input.decisionId);
      if (!decision || decision.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Decision not found." });
      }
      return getLaterContextsForDecision(db, decision.id);
    }),
});
