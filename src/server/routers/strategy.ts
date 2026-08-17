import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { getAllAnswersForInvestor } from "@/db/repositories/interview";
import {
  ensureDefaultRiskPrinciples,
  insertDeclaredPrinciple,
  insertObservedPrincipleWithEvidence,
  listStrategyPrinciplesForInvestor,
  approveStrategyVersion,
  getLatestStrategyVersion,
} from "@/db/repositories/strategy";
import { getEvidenceForStrategyPrinciple } from "@/db/repositories/evidence";
import { extractDeclaredPrinciples, proposeObservedPrinciples } from "@/lib/ai/strategy";
import {
  validateProposedDeclaredPrinciples,
  validateProposedObservedPrinciples,
} from "@/lib/strategy/validate-principles";
import { isUniqueViolation } from "@/db/errors";

export const strategyRouter = router({
  // Fixed baseline risk principles (docs/architecture.md §2.4) — code
  // only, idempotent by key. Safe to call whenever the Strategy view
  // loads.
  ensureDefaults: protectedProcedure.mutation(({ ctx }) =>
    ensureDefaultRiskPrinciples(db, ctx.investorId)
  ),

  // Step 1 of Declared: AI extracts candidate rules from interview
  // answers; nothing is persisted yet — the user reviews and confirms
  // each one individually via confirmDeclared (docs/architecture.md
  // §2.4: "AI מחלץ, משתמש מאשר").
  proposeDeclared: protectedProcedure.mutation(async ({ ctx }) => {
    const answers = await getAllAnswersForInvestor(db, ctx.investorId);
    if (answers.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No interview answers found yet — complete the onboarding interview first.",
      });
    }

    const proposed = await extractDeclaredPrinciples(
      answers.map((a) => ({ id: a.id, questionText: a.questionText, answerText: a.answerText }))
    );
    const validAnswerIds = new Set(answers.map((a) => a.id));
    const validated = validateProposedDeclaredPrinciples(proposed, validAnswerIds);

    return {
      proposedCount: proposed.length,
      candidates: validated,
    };
  }),

  // Step 2 of Declared: persists exactly one user-confirmed candidate
  // (the user may have lightly edited the wording). Citations are
  // re-validated against real rows here too — the client's word alone is
  // never trusted for what gets written.
  confirmDeclared: protectedProcedure
    .input(
      z.object({
        statementText: z.string().min(1),
        rationaleText: z.string(),
        citedAnswerIds: z.array(z.string().uuid()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const answers = await getAllAnswersForInvestor(db, ctx.investorId);
      const validAnswerIds = new Set(answers.map((a) => a.id));
      const [validated] = validateProposedDeclaredPrinciples([input], validAnswerIds);

      if (!validated) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "None of the cited answers belong to this investor.",
        });
      }

      return insertDeclaredPrinciple(db, ctx.investorId, validated);
    }),

  // Observed: same Evidence engine as DNA (docs/architecture.md §2.4) —
  // written immediately, no pre-approval gate; the user can disagree
  // afterward once Correction is wired up to Strategy (out of scope
  // here, see docs/architecture.md §2.4 Done bar).
  generateObserved: protectedProcedure.mutation(async ({ ctx }) => {
    const answers = await getAllAnswersForInvestor(db, ctx.investorId);
    if (answers.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No interview answers found yet — complete the onboarding interview first.",
      });
    }

    const proposed = await proposeObservedPrinciples(
      answers.map((a) => ({ id: a.id, questionText: a.questionText, answerText: a.answerText }))
    );
    const validAnswerIds = new Set(answers.map((a) => a.id));
    const validated = validateProposedObservedPrinciples(proposed, validAnswerIds);

    const created = [];
    for (const principle of validated) {
      created.push(await insertObservedPrincipleWithEvidence(db, ctx.investorId, principle));
    }

    return {
      proposedCount: proposed.length,
      createdCount: created.length,
      droppedCount: proposed.length - created.length,
      principles: created,
    };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const [principles, latestVersion] = await Promise.all([
      listStrategyPrinciplesForInvestor(db, ctx.investorId),
      getLatestStrategyVersion(db, ctx.investorId),
    ]);
    return { principles, latestVersion: latestVersion ?? null };
  }),

  evidence: protectedProcedure
    .input(z.object({ strategyPrincipleId: z.string().uuid() }))
    .query(({ input }) => getEvidenceForStrategyPrinciple(db, input.strategyPrincipleId)),

  // "User approves a change -> new [whole-Strategy] version"
  // (docs/architecture.md §2.4) — bundles the current latest version of
  // every principle (declared + observed + validated) into one new
  // StrategyVersion.
  approveVersion: protectedProcedure
    .input(z.object({ changeSummary: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const principles = await listStrategyPrinciplesForInvestor(db, ctx.investorId);
      if (principles.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No strategy principles yet — generate or confirm at least one first.",
        });
      }
      // approveStrategyVersion computes the next version_number from the
      // current latest, then inserts — a genuine concurrent approval (two
      // tabs, a retried request) can race that computation and hit
      // UNIQUE(investor_id, version_number). Unlike decisions.create,
      // there's no earlier app-level check for this to fall back to
      // (the original double-click incident that led here didn't race in
      // this narrow sense — see git history), so this is the only place
      // it's caught. Recoverable by simply retrying, unlike a decision.
      try {
        return await approveStrategyVersion(db, ctx.investorId, input.changeSummary);
      } catch (err) {
        if (isUniqueViolation(err, "strategy_versions_investor_id_version_number_unique")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Another approval just went through — please try again.",
          });
        }
        throw err;
      }
    }),
});
