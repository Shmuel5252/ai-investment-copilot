import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { isUniqueViolation, StaleIdentityVersionError } from "@/db/errors";
import { getAllAnswersForInvestor } from "@/db/repositories/interview";
import {
  listActiveDnaHypothesesForInvestor,
  insertDnaHypothesisWithEvidence,
  insertDnaHypothesisVersionWithEvidence,
  setDnaHypothesisStatus,
  getLatestDnaHypothesisVersion,
} from "@/db/repositories/dna";
import { getCountingEvidenceForDnaVersion, getEffectiveEvidenceForDnaHypothesisVersion } from "@/db/repositories/evidence";
import { proposeDnaHypotheses } from "@/lib/ai/dna";
import { checkEvidenceGrounding } from "@/lib/ai/dna-grounding";
import { classifyHypothesisMatch } from "@/lib/ai/dna-identity";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import { groundValidatedHypotheses } from "@/lib/dna/ground-evidence";
import {
  resolveHypothesisIdentities,
  type ExistingHypothesisForMatching,
} from "@/lib/dna/resolve-hypothesis-identity";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";

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

    // Evidence Strength must count independent DECISIONS, not raw
    // transactions or raw Evidence rows: several answers about one position
    // episode (e.g. MP's BUY, partial SELL, final SELL) are one case, and a
    // cross-ticker reallocation the investor described from both ends
    // (MP sold to fund MRVL) is a weak dependence edge that lowers the
    // supporting count. The resolver is loaded from persisted rows only and
    // is the exact same one strategy.ts's generateObserved counts through
    // (src/lib/evidence/resolve-independence.ts) — never a second,
    // parallel implementation.
    const independence = await loadIndependenceResolver(db, ctx.investorId, answers);
    const structurallyValidated = validateProposedHypotheses(proposed, independence);

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
    // the exact same shared independence resolver used everywhere else.
    // Fails closed: any grounding-check failure
    // excludes the citation, never includes it by default.
    const answerTextById = new Map(answers.map((a) => [a.id, a.answerText]));
    const { hypotheses: grounded } = await groundValidatedHypotheses(
      structurallyValidated,
      answerTextById,
      independence,
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
    //
    // What an existing identity has "already counted" is the EFFECTIVE
    // evidence of its CURRENT version — never its raw Evidence pool. Raw
    // rows are immutable provenance and include citations a grounding
    // remediation rejected; counting those would re-inflate S/C, the
    // independence groups and the "genuinely new" test, and let a rejected
    // citation mint a version. The version this is counted against is
    // remembered so the append can prove nothing moved underneath it.
    const existingActive = await listActiveDnaHypothesesForInvestor(db, ctx.investorId);
    const baseState = new Map<string, { versionId: string | undefined; checkCount: number }>();
    const existingForMatching: ExistingHypothesisForMatching[] = await Promise.all(
      existingActive.map(async (h) => {
        const latest = h.versions[0];
        const { effective, rejected, checkCount } = latest
          ? await getCountingEvidenceForDnaVersion(db, h.id, latest.id)
          : { effective: [], rejected: [], checkCount: 0 };
        baseState.set(h.id, { versionId: latest?.id, checkCount });
        return {
          id: h.id,
          statementText: latest?.statementText ?? "",
          evidenceForCounting: effective,
          rejectedEvidence: rejected,
        };
      })
    );

    const resolutions = await resolveHypothesisIdentities(
      grounded,
      existingForMatching,
      independence,
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
            independenceBasis: resolution.independenceBasis,
          })
        );
      } else if (resolution.action === "new_version") {
        try {
          const { version } = await insertDnaHypothesisVersionWithEvidence(db, resolution.hypothesisId, {
            expectedBaseVersionId: baseState.get(resolution.hypothesisId)!.versionId!,
            expectedBaseCheckCount: baseState.get(resolution.hypothesisId)!.checkCount,
            statementText: resolution.statement,
            evidenceStrength: resolution.evidenceStrength,
            supportingEvidenceCount: resolution.supportingCount,
            contradictingEvidenceCount: resolution.contradictingCount,
            independenceBasis: resolution.independenceBasis,
            newEvidence: resolution.newEvidence,
            changeReason: "New evidence from a later interview extended this existing pattern.",
          });
          newVersions.push({ hypothesisId: resolution.hypothesisId, version });
        } catch (err) {
          if (
            err instanceof StaleIdentityVersionError ||
            isUniqueViolation(err, "dna_hypothesis_versions_dna_hypothesis_id_version_number_unique")
          ) {
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

  // Version-aware (DNA Grounding Remediation task): "View Evidence" must
  // agree with the CURRENT version's own counts, not show the identity's
  // full raw citation pool unconditionally — the two only ever diverge
  // after a version has been through grounding remediation, and
  // getEffectiveEvidenceForDnaHypothesisVersion falls back to the exact
  // previous (raw, unfiltered) behavior for every version that hasn't
  // been. Raw/historical access itself is untouched and still exported
  // (getEvidenceForDnaHypothesis, used by audit and remediation) — nothing
  // about the underlying data becomes unreachable.
  evidence: protectedProcedure
    .input(z.object({ dnaHypothesisId: z.string().uuid() }))
    .query(async ({ input }) => {
      const latestVersion = await getLatestDnaHypothesisVersion(db, input.dnaHypothesisId);
      if (!latestVersion) return [];
      return getEffectiveEvidenceForDnaHypothesisVersion(db, input.dnaHypothesisId, latestVersion.id);
    }),

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
