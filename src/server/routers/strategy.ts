import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { getAllAnswersForInvestor } from "@/db/repositories/interview";
import {
  ensureDefaultRiskPrinciples,
  insertDeclaredPrinciple,
  insertObservedPrincipleWithEvidence,
  insertObservedPrincipleVersionWithEvidence,
  listStrategyPrinciplesForInvestor,
  approveStrategyVersion,
  getLatestStrategyVersion,
  getLatestStrategyPrincipleVersion,
} from "@/db/repositories/strategy";
import {
  getCountingEvidenceForStrategyPrincipleVersion,
  getEffectiveEvidenceForStrategyPrincipleVersion,
} from "@/db/repositories/evidence";
import { extractDeclaredPrinciples, proposeObservedPrinciples } from "@/lib/ai/strategy";
import {
  validateProposedDeclaredPrinciples,
  validateProposedObservedPrinciples,
} from "@/lib/strategy/validate-principles";
import { checkEvidenceGrounding } from "@/lib/ai/dna-grounding";
import { classifyHypothesisMatch } from "@/lib/ai/dna-identity";
import { groundValidatedObservedPrinciples } from "@/lib/strategy/ground-evidence";
import {
  resolveObservedPrincipleIdentities,
  filterToObservedCandidates,
  type ExistingObservedPrincipleForMatching,
} from "@/lib/strategy/resolve-principle-identity";
import { isUniqueViolation, StaleIdentityVersionError } from "@/db/errors";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";

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
  //
  // Strategy Grounding + Identity Hardening task: structural validation
  // is now followed by two more gates, mirroring dna.ts's generate
  // exactly — Evidence Grounding (checkEvidenceGrounding, reused
  // unmodified) filters citations against the REAL persisted
  // InterviewAnswer.answerText before anything is written, then Identity
  // Resolution (classifyHypothesisMatch, reused unmodified) matches
  // surviving proposals against existing ACTIVE OBSERVED principles (and
  // against each other within this same batch) instead of unconditionally
  // creating a new identity every time.
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
    // Same shared resolver as dna.ts's generate (Decision Independence
    // V1): evidence is collapsed by independent decision — position
    // episode, confirmed link, or a corroborated cross-ticker weak edge —
    // before it feeds evidenceStrength. One algorithm for DNA and
    // Strategy, never a second implementation.
    const independence = await loadIndependenceResolver(db, ctx.investorId, answers);
    const structurallyValidated = validateProposedObservedPrinciples(proposed, independence);

    // Evidence Grounding — same real gap class DNA had, never checked for
    // Strategy before this task: a citation can reference a real answer,
    // a real stance, a non-empty description, and still selectively
    // reframe what that answer actually says. Checks every citation
    // against the REAL persisted answerText, never the AI's own
    // description.
    const answerTextById = new Map(answers.map((a) => [a.id, a.answerText]));
    const { principles: grounded } = await groundValidatedObservedPrinciples(
      structurallyValidated,
      answerTextById,
      independence,
      checkEvidenceGrounding
    );

    // Identity Resolution — matches each grounded proposal against this
    // investor's existing ACTIVE OBSERVED principles AND against other
    // proposals in the SAME batch. Filtered to principleType==="observed"
    // HERE, at the call site, before anything is handed to
    // resolveObservedPrincipleIdentities — declared and validated/
    // system-default principles must never be match candidates for a
    // freshly-observed pattern (see resolve-principle-identity.ts's own
    // header comment for why: strategyPrinciples is a heterogeneous
    // identity table DNA's dnaHypotheses has no equivalent split of).
    //
    // Same rule as dna.ts: an existing principle's "already counted" set is
    // the EFFECTIVE evidence of its CURRENT version, never its raw Evidence
    // pool (which includes citations grounding remediation rejected).
    const allExisting = await listStrategyPrinciplesForInvestor(db, ctx.investorId);
    const existingObserved = filterToObservedCandidates(allExisting);
    const baseState = new Map<string, { versionId: string | undefined; checkCount: number }>();
    const existingForMatching: ExistingObservedPrincipleForMatching[] = await Promise.all(
      existingObserved.map(async (p) => {
        const latest = p.versions[0];
        const { effective, rejected, checkCount } = latest
          ? await getCountingEvidenceForStrategyPrincipleVersion(db, p.id, latest.id)
          : { effective: [], rejected: [], checkCount: 0 };
        baseState.set(p.id, { versionId: latest?.id, checkCount });
        return {
          id: p.id,
          statementText: latest?.statementText ?? "",
          evidenceForCounting: effective,
          rejectedEvidence: rejected,
        };
      })
    );

    const resolutions = await resolveObservedPrincipleIdentities(
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
          await insertObservedPrincipleWithEvidence(db, ctx.investorId, {
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
          const { version } = await insertObservedPrincipleVersionWithEvidence(db, resolution.principleId, {
            expectedBaseVersionId: baseState.get(resolution.principleId)!.versionId!,
            expectedBaseCheckCount: baseState.get(resolution.principleId)!.checkCount,
            statementText: resolution.statement,
            evidenceStrength: resolution.evidenceStrength,
            supportingEvidenceCount: resolution.supportingCount,
            contradictingEvidenceCount: resolution.contradictingCount,
            independenceBasis: resolution.independenceBasis,
            newEvidence: resolution.newEvidence,
            changeReason: "New evidence from a later interview extended this existing pattern.",
          });
          newVersions.push({ principleId: resolution.principleId, version });
        } catch (err) {
          if (
            err instanceof StaleIdentityVersionError ||
            isUniqueViolation(err, "strategy_principle_versions_strategy_principle_id_version_numbe")
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Another generation just updated this principle — please try again.",
            });
          }
          throw err;
        }
      } else {
        skipped.push({ principleId: resolution.principleId, statement: resolution.statement });
      }
    }

    return {
      proposedCount: proposed.length,
      createdCount: createdIdentities.length,
      droppedCount: proposed.length - grounded.length,
      versionedCount: newVersions.length,
      unchangedCount: skipped.length,
      principles: createdIdentities,
      newVersions,
      skipped,
    };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const [principles, latestVersion] = await Promise.all([
      listStrategyPrinciplesForInvestor(db, ctx.investorId),
      getLatestStrategyVersion(db, ctx.investorId),
    ]);
    return { principles, latestVersion: latestVersion ?? null };
  }),

  // Version-aware (Strategy Grounding + Identity Hardening task): "View
  // Evidence" must agree with the CURRENT version's own counts, not show
  // the identity's full raw citation pool unconditionally — mirrors
  // dna.ts's evidence query exactly. Raw/historical access itself is
  // untouched (getEvidenceForStrategyPrinciple, used by audit and
  // remediation).
  evidence: protectedProcedure
    .input(z.object({ strategyPrincipleId: z.string().uuid() }))
    .query(async ({ input }) => {
      const latestVersion = await getLatestStrategyPrincipleVersion(db, input.strategyPrincipleId);
      if (!latestVersion) return [];
      return getEffectiveEvidenceForStrategyPrincipleVersion(db, input.strategyPrincipleId, latestVersion.id);
    }),

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
