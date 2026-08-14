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
import type { MarketIntelligence } from "@/lib/market/fmp";

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
  generatePersonalFit: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const investmentCase = await requireOwnedCase(ctx.investorId, input.caseId);
      const idea = investmentCase.ideaId ? await getIdea(db, investmentCase.ideaId) : undefined;

      const [dnaHypotheses, strategyPrinciples] = await Promise.all([
        listActiveDnaHypothesesForInvestor(db, ctx.investorId),
        listStrategyPrinciplesForInvestor(db, ctx.investorId),
      ]);

      const dnaForAi = dnaHypotheses
        .map((h) => {
          const version = h.versions[0];
          return version ? { id: h.id, statementText: version.statementText, evidenceStrength: version.evidenceStrength } : null;
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);

      const strategyForAi = strategyPrinciples
        .map((p) => {
          const version = p.versions[0];
          return version ? { id: p.id, statementText: version.statementText, principleType: version.principleType } : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);

      const proposed = await synthesizePersonalFit({
        ticker: investmentCase.ticker,
        ideaNoteText: idea?.noteText,
        dnaHypotheses: dnaForAi,
        strategyPrinciples: strategyForAi,
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
