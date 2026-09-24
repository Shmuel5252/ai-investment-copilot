import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { getDecision } from "@/db/repositories/decisions";
import { ExecutionFactValidationError, insertDecisionExecutionFact, loadEffectiveExecutionFactsForDecision } from "@/db/repositories/execution-facts";
import { loadDecisionAttention } from "@/lib/monitoring/load-decision-attention";
import { InvalidTimeZoneError, type ExecutionFact } from "@/lib/monitoring/decision-attention";
import { canExecute, EXECUTED_SIDE } from "@/lib/execution/execution-facts";

// Decision Follow-Through V1 (docs/architecture.md §2.10). The candidate set is
// the monitoring's own execution groups for the decision (same-ticker BUY/SELL
// rows placed around the decision day in the investor's zone) — one
// derivation, never a second one here — annotated with the investor's
// effective execution facts. The system labels candidates; only the investor
// asserts a verdict, and the repository enforces what can be asserted.

const timeZoneSchema = z.string().min(1).max(64);

async function requireOwnedDecision(investorId: string, decisionId: string) {
  const decision = await getDecision(db, decisionId);
  if (!decision || decision.investorId !== investorId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Decision not found." });
  }
  return decision;
}

export const executionsRouter = router({
  candidates: protectedProcedure
    .input(z.object({ decisionId: z.string().uuid(), timeZone: timeZoneSchema }))
    .query(async ({ ctx, input }) => {
      const decision = await requireOwnedDecision(ctx.investorId, input.decisionId);
      let attention;
      try {
        attention = await loadDecisionAttention(db, ctx.investorId, input.timeZone);
      } catch (err) {
        if (err instanceof InvalidTimeZoneError) throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        throw err;
      }
      const item = attention.items.find((i) => i.decisionId === decision.id);
      const facts = await loadEffectiveExecutionFactsForDecision(db, decision.id);
      const factByTransaction = new Map(facts.map((f) => [f.transaction.id, f]));
      const annotate = (group: "after" | "sameDay" | "backfilledBefore" | "knownBefore") => (f: ExecutionFact) => {
        const fact = factByTransaction.get(f.transactionId) ?? null;
        return {
          group,
          transactionId: f.transactionId,
          transactionType: f.transactionType,
          transactionDate: f.transactionDate,
          quantity: f.quantity,
          price: f.price,
          episodeKey: f.episodeKey,
          canExecute: canExecute(decision, { transactionType: f.transactionType, transactionDate: f.transactionDate }, input.timeZone),
          assertion: fact ? { factId: fact.id, verdict: fact.verdict, note: fact.note } : null,
        };
      };
      const execution = item?.execution ?? { status: "history_before_decision" as const, historyThrough: null, knownBefore: [], backfilledBefore: [], sameDay: [], after: [] };
      return {
        decisionType: decision.decisionType,
        executedSide: EXECUTED_SIDE[decision.decisionType] ?? null,
        status: execution.status,
        historyThrough: execution.historyThrough,
        candidates: [
          ...execution.after.map(annotate("after")),
          ...execution.sameDay.map(annotate("sameDay")),
          ...execution.backfilledBefore.map(annotate("backfilledBefore")),
          ...execution.knownBefore.map(annotate("knownBefore")),
        ],
        executed: facts.filter((f) => f.verdict === "executed"),
        unrelatedCount: facts.filter((f) => f.verdict === "unrelated").length,
      };
    }),

  // One assertion = one appended fact; an identical retry replays, a change
  // of mind supersedes. The repository enforces ownership, ticker, side and
  // day rules atomically (advisory lock per investor).
  assert: protectedProcedure
    .input(
      z.object({
        decisionId: z.string().uuid(),
        transactionId: z.string().uuid(),
        verdict: z.enum(["executed", "unrelated"]),
        timeZone: timeZoneSchema,
        note: z.string().max(2000).optional(),
        supersedesFactId: z.string().uuid().optional(),
        shownBasis: z.unknown().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwnedDecision(ctx.investorId, input.decisionId);
      try {
        return await insertDecisionExecutionFact(db, {
          investorId: ctx.investorId,
          decisionId: input.decisionId,
          transactionId: input.transactionId,
          verdict: input.verdict,
          timeZone: input.timeZone,
          note: input.note ?? null,
          supersedesFactId: input.supersedesFactId ?? null,
          shownBasisJson: input.shownBasis ?? null,
        });
      } catch (err) {
        if (err instanceof InvalidTimeZoneError) throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        if (err instanceof ExecutionFactValidationError) throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        throw err;
      }
    }),

  forDecision: protectedProcedure.input(z.object({ decisionId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const decision = await requireOwnedDecision(ctx.investorId, input.decisionId);
    return loadEffectiveExecutionFactsForDecision(db, decision.id);
  }),
});
