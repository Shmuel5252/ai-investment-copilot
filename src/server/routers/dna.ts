import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { getAllAnswersForInvestor } from "@/db/repositories/interview";
import {
  listActiveDnaHypothesesForInvestor,
  insertDnaHypothesisWithEvidence,
  insertDnaHypothesisVersionWithEvidence,
  setDnaHypothesisStatus,
} from "@/db/repositories/dna";
import { getEvidenceForDnaHypothesis } from "@/db/repositories/evidence";
import { proposeDnaHypotheses } from "@/lib/ai/dna";
import { checkEvidenceGrounding } from "@/lib/ai/dna-grounding";
import { classifyHypothesisMatch } from "@/lib/ai/dna-identity";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import { groundValidatedHypotheses } from "@/lib/dna/ground-evidence";
import {
  resolveHypothesisIdentities,
  type ExistingHypothesisForMatching,
} from "@/lib/dna/resolve-hypothesis-identity";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";
import { buildAnswerCaseKeys } from "@/lib/evidence/build-answer-case-keys";

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

    // Evidence Strength must count independent investment EPISODES, not
    // raw transactions or raw Evidence rows (Investment Episode
    // Independence design, this session) — a real gap found on real data:
    // two different InterviewAnswers about the same transaction (the
    // interview can be re-run in a later session and re-select a
    // transaction already asked about before), AND several different
    // transactions belonging to the same continuous position lifecycle
    // (e.g. MP's BUY, partial SELL, final SELL), must all collapse to one
    // independent case — never one-per-answer or one-per-transaction.
    // buildAnswerCaseKeys is the exact same shared function
    // strategy.ts's generateObserved uses, fed by the exact same
    // deriveEpisodeKeys computation computePositionsForInvestor already
    // exposes (src/lib/portfolio/positions.ts) — never a second,
    // parallel implementation of either.
    const positions = await computePositionsForInvestor(db, ctx.investorId);
    const answerCaseKeys = buildAnswerCaseKeys(answers, positions.episodeKeyByTransactionId);
    const structurallyValidated = validateProposedHypotheses(proposed, answerCaseKeys);

    // Evidence Grounding (Evidence Grounding + Hypothesis Identity
    // Hardening task) — a SEPARATE gate from the structural checks above.
    // A citation can reference a real answer id, a real stance, and a
    // non-empty description, and still selectively reframe what that
    // answer actually says (the real CAN case: a missed Nasdaq compliance
    // deadline and a declining stock, cited as "sold a profitable
    // position for a better opportunity, thesis intact"). This checks
    // every citation against the REAL persisted answerText — never the
    // AI's own description — and recomputes supportingCount/
    // contradictingCount/evidenceStrength from only what survives, via
    // the exact same countIndependentCases()/calculateEvidenceStrength()
    // used everywhere else. Fails closed: any grounding-check failure
    // excludes the citation, never includes it by default.
    const answerTextById = new Map(answers.map((a) => [a.id, a.answerText]));
    const { hypotheses: grounded } = await groundValidatedHypotheses(
      structurallyValidated,
      answerTextById,
      answerCaseKeys,
      checkEvidenceGrounding
    );

    // Hypothesis Identity (same task) — every past generate() call
    // created a brand-new identity for every surviving proposal,
    // unconditionally. This matches each grounded proposal against this
    // investor's existing active hypotheses AND against other proposals
    // in the SAME batch (resolveHypothesisIdentities grows one shared
    // candidate pool for both), then decides per group: a genuinely new
    // identity, a new version of an existing identity (only when the
    // combined evidence contains an independent case the existing
    // identity's persisted evidence didn't already have), or nothing to
    // do (matched an existing identity but added no new independent
    // case). Existing identities/versions/evidence are never edited —
    // only ever added to.
    const existingActive = await listActiveDnaHypothesesForInvestor(db, ctx.investorId);
    const existingForMatching: ExistingHypothesisForMatching[] = await Promise.all(
      existingActive.map(async (h) => {
        const ev = await getEvidenceForDnaHypothesis(db, h.id);
        return {
          id: h.id,
          statementText: h.versions[0]?.statementText ?? "",
          evidenceForCounting: ev
            .filter((e): e is typeof e & { interviewAnswerId: string } => e.interviewAnswerId !== null)
            .map((e) => ({ interviewAnswerId: e.interviewAnswerId, stance: e.stance })),
        };
      })
    );

    const resolutions = await resolveHypothesisIdentities(
      grounded,
      existingForMatching,
      answerCaseKeys,
      classifyHypothesisMatch
    );

    const createdIdentities = [];
    const newVersions = [];
    const skipped = [];

    for (const resolution of resolutions) {
      if (resolution.action === "new_identity") {
        createdIdentities.push(
          await insertDnaHypothesisWithEvidence(db, ctx.investorId, {
            statement: resolution.statement,
            evidence: resolution.evidence,
            supportingCount: resolution.supportingCount,
            contradictingCount: resolution.contradictingCount,
            evidenceStrength: resolution.evidenceStrength,
          })
        );
      } else if (resolution.action === "new_version") {
        try {
          const { version } = await insertDnaHypothesisVersionWithEvidence(db, resolution.hypothesisId, {
            statementText: resolution.statement,
            evidenceStrength: resolution.evidenceStrength,
            supportingEvidenceCount: resolution.supportingCount,
            contradictingEvidenceCount: resolution.contradictingCount,
            newEvidence: resolution.newEvidence,
            changeReason: "New evidence from a later interview extended this existing pattern.",
          });
          newVersions.push({ hypothesisId: resolution.hypothesisId, version });
        } catch (err) {
          if (isUniqueViolation(err, "dna_hypothesis_versions_dna_hypothesis_id_version_number_unique")) {
            // A genuine concurrent generate() race on the same identity —
            // recoverable by simply retrying the whole generate call,
            // same as strategy.ts's approveVersion.
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Another generation just updated this hypothesis — please try again.",
            });
          }
          throw err;
        }
      } else {
        skipped.push({ hypothesisId: resolution.hypothesisId, statement: resolution.statement });
      }
    }

    return {
      proposedCount: proposed.length,
      createdCount: createdIdentities.length,
      droppedCount: proposed.length - grounded.length,
      versionedCount: newVersions.length,
      unchangedCount: skipped.length,
      hypotheses: createdIdentities,
      newVersions,
      skipped,
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
