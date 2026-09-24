import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import {
  insertInvestmentCase,
  getInvestmentCase,
  listInvestmentCasesForInvestor,
  updateInvestmentCase,
  getIdea,
} from "@/db/repositories/ideas-cases";
import { listActiveDnaHypothesesForInvestor } from "@/db/repositories/dna";
import { listStrategyPrinciplesForInvestor } from "@/db/repositories/strategy";
import { getMarketIntelligence } from "@/lib/market/market-intelligence";
import { computePortfolioFitForInvestor } from "@/lib/portfolio/portfolio-fit-for-investor";
import { synthesizeInvestmentCase, synthesizePersonalFit } from "@/lib/ai/case";
import { validatePersonalFit } from "@/lib/case/validate-personal-fit";
import { excludeInsufficientEvidence } from "@/lib/dna/evidence-strength";
import type { MarketIntelligence } from "@/lib/market/fmp";
import { loadPriorRecordBrief } from "@/lib/prior-record/load-prior-record";

async function requireOwnedCase(investorId: string, caseId: string) {
  const investmentCase = await getInvestmentCase(db, caseId);
  if (!investmentCase || investmentCase.investorId !== investorId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Investment case not found." });
  }
  return investmentCase;
}

export const casesRouter = router({
  // "משתמש: יוצר Idea קצר או Case ישירות" — this is the direct path,
  // without an Idea in between.
  create: protectedProcedure
    .input(z.object({ ticker: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      insertInvestmentCase(db, { investorId: ctx.investorId, ticker: input.ticker.trim().toUpperCase() })
    ),

  list: protectedProcedure.query(({ ctx }) => listInvestmentCasesForInvestor(db, ctx.investorId)),

  get: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(({ ctx, input }) => requireOwnedCase(ctx.investorId, input.caseId)),

  // Market Intelligence — "מחיר/valuation בסיסי מ-API אמיתי אחד (FMP)"
  // (docs/architecture.md §2.5). Real data only; a bad/unknown ticker
  // surfaces as a clear tRPC error, never a fabricated fallback.
  fetchMarketIntelligence: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), forceRefresh: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const investmentCase = await requireOwnedCase(ctx.investorId, input.caseId);
      const intelligence = await getMarketIntelligence(db, investmentCase.ticker, {
        forceRefresh: input.forceRefresh,
      });
      return updateInvestmentCase(db, investmentCase.id, {
        marketIntelligenceJson: intelligence,
        marketIntelligenceFetchedAt: new Date(intelligence.fetchedAt),
      });
    }),

  // Portfolio Fit — always computed live, never stored
  // (docs/data-model.md §0/§4): this endpoint has no case-row write of
  // its own, it just returns the current numbers. Requires Market
  // Intelligence to already be fetched (needs the candidate's current
  // price) — fetch that first rather than silently reusing a stale or
  // fabricated price.
  computePortfolioFit: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), sizeDollars: z.number().positive().optional() }))
    .mutation(async ({ ctx, input }) => {
      const investmentCase = await requireOwnedCase(ctx.investorId, input.caseId);
      const intelligence = investmentCase.marketIntelligenceJson as MarketIntelligence | null;
      if (!intelligence) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Fetch market data for this case first — Portfolio Fit needs a current price.",
        });
      }
      return computePortfolioFitForInvestor(db, ctx.investorId, {
        ticker: investmentCase.ticker,
        price: intelligence.price,
        sector: intelligence.sector,
        industry: intelligence.industry,
        sizeDollars: input.sizeDollars,
      });
    }),

  // Bull/Bear/Catalysts/Invalidation/Market Blindspot/Devil's Advocate +
  // a narrative read of Portfolio Fit — all grounded in the Market
  // Intelligence and Portfolio Fit already computed above, never invented
  // (docs/architecture.md §2.5).
  generateSynthesis: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), sizeDollars: z.number().positive().optional() }))
    .mutation(async ({ ctx, input }) => {
      const investmentCase = await requireOwnedCase(ctx.investorId, input.caseId);
      const intelligence = investmentCase.marketIntelligenceJson as MarketIntelligence | null;
      if (!intelligence) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Fetch market data for this case first.",
        });
      }

      const idea = investmentCase.ideaId ? await getIdea(db, investmentCase.ideaId) : undefined;
      const portfolioFit = await computePortfolioFitForInvestor(db, ctx.investorId, {
        ticker: investmentCase.ticker,
        price: intelligence.price,
        sector: intelligence.sector,
        industry: intelligence.industry,
        sizeDollars: input.sizeDollars,
      });

      const synthesis = await synthesizeInvestmentCase({
        ticker: investmentCase.ticker,
        ideaNoteText: idea?.noteText,
        marketIntelligence: intelligence,
        portfolioFit,
      });

      return updateInvestmentCase(db, investmentCase.id, synthesis);
    }),

  // Personal Fit — vs. DNA + Strategy, shown separately from Portfolio
  // Fit, never averaged together (docs/architecture.md §2.5). Citations
  // are validated against this investor's real DNA hypothesis / Strategy
  // principle ids before being stored.
  // Prior Record Brief V1 (docs/architecture.md §2.5a) — the investor's
  // own record on this case's ticker, before deciding. Read-only, derived on
  // read, no AI, no market data; the case's own decision (if any) is not
  // "prior" and is excluded.
  priorRecord: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const investmentCase = await requireOwnedCase(ctx.investorId, input.caseId);
      return loadPriorRecordBrief(db, {
        investorId: ctx.investorId,
        ticker: investmentCase.ticker,
        excludeInvestmentCaseId: investmentCase.id,
      });
    }),

  generatePersonalFit: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const investmentCase = await requireOwnedCase(ctx.investorId, input.caseId);
      const idea = investmentCase.ideaId ? await getIdea(db, investmentCase.ideaId) : undefined;

      // New precondition (docs/backlog.md, Sector/Industry Exposure) —
      // Personal Fit previously ran with no Market Intelligence
      // dependency at all; it now needs the candidate's own price/
      // sector/industry to compute real sector/industry exposure, the
      // same way computePortfolioFit/generateSynthesis above already
      // require it. investmentCase is already in memory from
      // requireOwnedCase above — no extra DB read to check this.
      const intelligence = investmentCase.marketIntelligenceJson as MarketIntelligence | null;
      if (!intelligence) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Fetch market data for this case first — Personal Fit needs sector/industry exposure numbers.",
        });
      }

      const [dnaHypotheses, strategyPrinciples, portfolioFit] = await Promise.all([
        listActiveDnaHypothesesForInvestor(db, ctx.investorId),
        listStrategyPrinciplesForInvestor(db, ctx.investorId),
        // No sizeDollars — Personal Fit isn't about a hypothetical size,
        // only current exposure (docs/backlog.md). Reuses the same
        // shared computePortfolioFitForInvestor the two mutations above
        // already call — not a parallel fetch-loop implementation.
        computePortfolioFitForInvestor(db, ctx.investorId, {
          ticker: investmentCase.ticker,
          price: intelligence.price,
          sector: intelligence.sector,
          industry: intelligence.industry,
        }),
      ]);

      // insufficient_evidence hypotheses/principles are excluded here,
      // at the code layer, before the AI ever sees them — a real gap
      // found on real data: a verbal "hedge it" prompt instruction still
      // let a thin item lean the personalFitText's direction, even
      // labeled "thin". Structurally excluding them is the fix (CLAUDE.md:
      // code enforces this, not the model's own restraint).
      const dnaForAi = excludeInsufficientEvidence(
        dnaHypotheses
          .map((h) => {
            const version = h.versions[0];
            return version ? { id: h.id, statementText: version.statementText, evidenceStrength: version.evidenceStrength } : null;
          })
          .filter((h): h is NonNullable<typeof h> => h !== null)
      );

      const strategyForAi = excludeInsufficientEvidence(
        strategyPrinciples
          .map((p) => {
            const version = p.versions[0];
            return version
              ? {
                  id: p.id,
                  statementText: version.statementText,
                  principleType: version.principleType,
                  evidenceStrength: version.evidenceStrength,
                }
              : null;
          })
          .filter((p): p is NonNullable<typeof p> => p !== null)
      );

      const proposed = await synthesizePersonalFit({
        ticker: investmentCase.ticker,
        ideaNoteText: idea?.noteText,
        dnaHypotheses: dnaForAi,
        strategyPrinciples: strategyForAi,
        // The candidate's own classification — same `intelligence`
        // object already in memory above for the precondition check and
        // for computePortfolioFitForInvestor's candidate arg; no new
        // fetch (docs/backlog.md, Sector + Industry Exposure — Personal
        // Fit blocker, external review before commit).
        candidateSector: intelligence.sector,
        candidateIndustry: intelligence.industry,
        sectorExposure: portfolioFit.sectorExposure,
        industryExposure: portfolioFit.industryExposure,
      });

      const validated = validatePersonalFit(
        proposed,
        new Set(dnaForAi.map((h) => h.id)),
        new Set(strategyForAi.map((p) => p.id))
      );

      return updateInvestmentCase(db, investmentCase.id, {
        personalFitText: validated.personalFitText,
        personalFitEvidenceRefs: {
          dnaHypothesisIds: validated.citedDnaHypothesisIds,
          strategyPrincipleIds: validated.citedStrategyPrincipleIds,
          hasTraceableEvidence: validated.hasTraceableEvidence,
        },
      });
    }),
});
