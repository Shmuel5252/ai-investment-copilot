import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { getTransaction } from "@/db/repositories/portfolio";
import {
  insertInterviewSession,
  insertInterviewAnswer,
  completeInterviewSession,
  getAnswersForSession,
  getInterviewSession,
  insertSupersedingInterviewAnswer,
  getAllAnswersForInvestor,
} from "@/db/repositories/interview";
import { loadEpisodeJournal as loadEpisodeJournalFor } from "@/lib/portfolio/load-episode-journal";
import { resolveTellMeWhyAnchor, toHindsightSafeJournal } from "@/lib/interview/journal";
import { selectStructuralAnchors } from "@/lib/interview/select-transactions";
import { buildTellMeWhyQuestion } from "@/lib/interview/tell-me-why-question";
import { loadAnchorHistory } from "@/lib/interview/load-anchor-history";
import { anchorContextHash, buildAnchorContext, exposedFacts, PIT_QUESTION_CONTRACT, type AnchorContextResult, type AnchorContextV1 } from "@/lib/interview/anchor-context";
import { fallbackQuestion, validatePitQuestion } from "@/lib/interview/question-safety";
import { generatePitQuestion, PIT_QUESTION_MODEL } from "@/lib/ai/interview";

// Episode Journal V1 — the derived journal over the investor's whole
// position history (src/lib/portfolio/episodes.ts). Episode membership is
// computePositionsForInvestor()'s own map — the exact same one the Decision
// Independence resolver counts evidence by (loadIndependenceContext) — and
// coverage is computed from getAllAnswersForInvestor, the exact reader
// dna.generate / strategy.generateObserved consume, so "covered" means
// "will be seen by generation". Read-only; nothing is stored.
// (The loader itself now lives in src/lib/portfolio/load-episode-journal.ts,
// shared with the Prior Record Brief — one derivation path, unchanged.)
const loadEpisodeJournal = (investorId: string) => loadEpisodeJournalFor(db, investorId);

async function requireOwnedSession(investorId: string, sessionId: string) {
  const session = await getInterviewSession(db, sessionId);
  if (!session || session.investorId !== investorId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Interview session not found." });
  }
  return session;
}

const RESTART = "The history behind this question changed, or it can no longer be asked as of that moment — start again to get a current question.";

const CONTEXT_REFUSAL: Record<Exclude<AnchorContextResult, { ok: true }>["reason"], string> = {
  not_found: "Transaction not found.",
  not_a_trade: "Only a buy or sell with a ticker and a quantity can anchor a question.",
  ambiguous_same_day: "This transaction shares its date with other trades of the same ticker whose order was never recorded, so what was known just before it cannot be established.",
  untrusted_history: "The history of this ticker before this transaction cannot be trusted (a sale exceeded the known holdings), so what was known just before it cannot be established.",
  insufficient_holdings: "This sale exceeds the holdings known just before it, so what was known at that moment cannot be established.",
};

function requireContext(result: AnchorContextResult, refusal?: string): AnchorContextV1 {
  if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: refusal ?? CONTEXT_REFUSAL[result.reason] });
  return result.context;
}

export const interviewRouter = router({
  // Guided Interview PIT contract (Unit 7C-B). Structural selection in code
  // (src/lib/interview/select-transactions.ts), a point-in-time context per
  // selected action, one AI question per context over its facts line ONLY,
  // the deterministic validator, and the code-built fallback for any rejected
  // or malformed wording. The session row is inserted only after every
  // question exists, so a failed AI call leaves nothing behind. Questions are
  // still not persisted here: the answer stores the question together with
  // the server-recomputed snapshot, verified against anchorContextHash.
  start: protectedProcedure.mutation(async ({ ctx }) => {
    const [history, answers] = await Promise.all([loadAnchorHistory(db, ctx.investorId), getAllAnswersForInvestor(db, ctx.investorId)]);
    const answered = new Set(answers.map((a) => a.transactionId).filter((id): id is string => id !== null));
    const selected = selectStructuralAnchors(history, { answeredTransactionIds: answered });

    if (selected.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No trade in the history can be asked about yet — import your trade history first.",
      });
    }

    const questions = await Promise.all(
      selected.map(async ({ context }) => {
        const facts = exposedFacts(context);
        const generated = await generatePitQuestion(context.factsLine);
        const accepted = generated !== null && validatePitQuestion(generated, facts).ok;
        return {
          anchor: context.anchor,
          factsLine: context.factsLine,
          questionText: accepted ? generated! : fallbackQuestion(facts),
          questionSource: (accepted ? "ai" : "deterministic") as "ai" | "deterministic",
          anchorContextHash: anchorContextHash(context),
        };
      })
    );

    const session = await insertInterviewSession(db, { investorId: ctx.investorId, origin: "guided_interview" });
    return { sessionId: session.id, questions };
  }),

  // Append-only (docs/data-model.md §0/§9): a new row every time. A
  // correction/update of an earlier answer is a NEW row whose
  // supersedesAnswerId points at the old one — the old text is never
  // touched, and getAllAnswersForInvestor simply stops returning it. The
  // session and any superseded answer must belong to this investor; an
  // answer can be superseded at most once (a chain, never a fork).
  //
  // Unit 7C-B: the stored row is verified, never trusted. The point-in-time
  // snapshot is recomputed from stored history for the answer's transaction;
  // its hash must equal the one interview.start / startTellMeWhy returned
  // (otherwise the history changed: restart); for a guided session the
  // question must also pass the same validator, and for "Tell me why" the
  // deterministic entry question is regenerated and must be identical. The row stores the server's snapshot,
  // with the provenance the server derives (a question equal to the
  // deterministic fallback is the fallback; any other accepted wording is AI).
  answer: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        transactionId: z.string().uuid(),
        questionText: z.string().min(1),
        answerText: z.string().min(1),
        supersedesAnswerId: z.string().uuid().optional(),
        /** Required for every session: the hash interview.start or interview.startTellMeWhy returned with this question. */
        anchorContextHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await requireOwnedSession(ctx.investorId, input.sessionId);
      // The anchor must be this investor's own transaction — an answer can
      // never point at a row it does not own (the guided interview and the
      // journal only ever hand back owned ids; this closes the raw API).
      const anchor = await getTransaction(db, input.transactionId);
      if (!anchor || anchor.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found." });
      }

      const context = requireContext(buildAnchorContext(await loadAnchorHistory(db, ctx.investorId), input.transactionId), RESTART);
      // The facts the investor saw at start must be the facts stored now
      // (guided and Tell me why alike): otherwise the history changed.
      if (!input.anchorContextHash || input.anchorContextHash !== anchorContextHash(context)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: RESTART });
      }
      let provenance: "guided_pit_ai" | "guided_pit_fallback" | "tell_me_why_pit";
      let anchorContext: AnchorContextV1;

      if (session.origin === "guided_interview") {
        const facts = exposedFacts(context);
        if (!validatePitQuestion(input.questionText, facts).ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This question is not one the interview can store." });
        }
        const isFallback = input.questionText === fallbackQuestion(facts);
        provenance = isFallback ? "guided_pit_fallback" : "guided_pit_ai";
        anchorContext = { ...context, generator: isFallback ? null : { contract: PIT_QUESTION_CONTRACT, model: PIT_QUESTION_MODEL, validated: true } };
      } else {
        const episode = (await loadEpisodeJournal(ctx.investorId)).episodes.find((e) => e.entry?.transactionId === input.transactionId);
        if (!episode || input.questionText !== buildTellMeWhyQuestion(episode.ticker)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: RESTART });
        }
        provenance = "tell_me_why_pit";
        anchorContext = context;
      }

      const values = {
        interviewSessionId: input.sessionId,
        transactionId: input.transactionId,
        questionText: input.questionText,
        answerText: input.answerText,
        questionProvenance: provenance,
        anchorContext,
      };
      if (input.supersedesAnswerId === undefined) return insertInterviewAnswer(db, values);

      // Ownership of the superseded answer and the one-successor rule are
      // checked under a row lock inside the repository, so a concurrent
      // double update cannot fork the chain.
      const result = await insertSupersedingInterviewAnswer(db, ctx.investorId, {
        ...values,
        supersedesAnswerId: input.supersedesAnswerId,
      });
      if (!result.ok) {
        if (result.reason === "not_found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "The answer being updated was not found." });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That answer has already been updated once — update its latest version instead.",
        });
      }
      return result.row;
    }),

  complete: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireOwnedSession(ctx.investorId, input.sessionId);
      await completeInterviewSession(db, input.sessionId);
      return { ok: true };
    }),

  // "Tell me why" — user-initiated, separate from the guided/algorithmic
  // flow above. Contract (Product decision, Episode Journal V1, 2026-09-22
  // — explicitly replaces the 2026-09-08 manual-entry-only contract):
  // available for ANY buy/sell transaction the investor owns that has a
  // ticker, whatever its source, whichever transaction of the episode was
  // chosen. The rationale is persisted against ONE deterministic anchor —
  // the episode's entry BUY (src/lib/portfolio/episodes.ts) — so the
  // returned `transactionId` is that anchor, not necessarily the one the
  // investor clicked; `requestedTransactionId` echoes the click. An episode
  // with no BUY (opened before the imported window) fails closed here. The
  // question is deterministic code, not AI (buildTellMeWhyQuestion): the
  // entry-only wording (Unit 7C-B), with the entry-time facts as the
  // snapshot's factsLine beside it and anchorContextHash to bring back with
  // the answer — never realized P&L, exit or later prices (hindsight
  // protection). Deliberately does NOT reuse
  // `start`: that re-selects from the whole history with maxCount=6 — the
  // wrong shape for "ask about the episode the investor chose". Saving
  // reuses `answer`/`complete` above.
  startTellMeWhy: protectedProcedure
    .input(z.object({ transactionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const transaction = await getTransaction(db, input.transactionId);
      if (!transaction || transaction.investorId !== ctx.investorId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found." });
      }
      if (transaction.transactionType !== "buy" && transaction.transactionType !== "sell") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "\"Tell me why\" is only available for a buy or sell — not a dividend, fee, deposit or withdrawal.",
        });
      }
      if (!transaction.ticker) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This transaction has no ticker to ask about.",
        });
      }

      const journal = await loadEpisodeJournal(ctx.investorId);
      const anchor = resolveTellMeWhyAnchor(journal, transaction.id);
      if (!anchor.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            anchor.reason === "no_entry_anchor"
              ? "This position has no buy in the imported history (it was probably opened before the import window), so there is no decision to anchor a rationale to."
              : "This transaction does not belong to any investment episode.",
        });
      }

      // Unit 7C-B: the entry's point-in-time snapshot must exist before a
      // session is opened (same-day order before the entry BUY must be
      // authoritative); its facts line is returned beside the question, never
      // inside it.
      const context = requireContext(buildAnchorContext(await loadAnchorHistory(db, ctx.investorId), anchor.anchorTransactionId));

      const session = await insertInterviewSession(db, {
        investorId: ctx.investorId,
        origin: "user_initiated",
      });
      const { episode } = anchor;

      return {
        sessionId: session.id,
        transactionId: anchor.anchorTransactionId,
        requestedTransactionId: transaction.id,
        ticker: episode.ticker,
        episodeKey: episode.key,
        episodeStatus: episode.status,
        factsLine: context.factsLine,
        questionText: buildTellMeWhyQuestion(episode.ticker),
        anchorContextHash: anchorContextHash(context),
      };
    }),

  // The hindsight-safe journal (src/lib/interview/journal.ts): later/outcome
  // facts are omitted server-side for every episode without a rationale.
  journal: protectedProcedure.query(async ({ ctx }) => toHindsightSafeJournal(await loadEpisodeJournal(ctx.investorId))),

  journalCoverage: protectedProcedure.query(async ({ ctx }) => (await loadEpisodeJournal(ctx.investorId)).coverage),

  answersForSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireOwnedSession(ctx.investorId, input.sessionId);
      return getAnswersForSession(db, input.sessionId);
    }),
});
