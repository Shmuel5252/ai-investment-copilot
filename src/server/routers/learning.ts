import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { listReviewedDecisionsForInvestor, getLaterContextsForDecision } from "@/db/repositories/decisions";
import {
  upsertLearningInsightForFamily,
  mapReviewIdsToDecisionIds,
  listLearningInsightsForInvestor,
  getLearningInsight,
  getLatestLearningInsightVersion,
} from "@/db/repositories/learning";
import { getEvidenceForLearningInsight } from "@/db/repositories/evidence";
import { carryLearningInsightToDna, findCarriedHypothesisForInsight } from "@/db/repositories/dna";
import { listDecisionStatementsForInvestor } from "@/db/repositories/decision-statements";
import { buildLearningCarryCases, citedReviewsOfVersion, groundCarryCitations } from "@/lib/learning/carry-to-dna";
import { checkEvidenceGrounding } from "@/lib/ai/dna-grounding";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import { assessCitations } from "@/lib/evidence/resolve-independence";
import { buildProvenance } from "@/lib/evidence/provenance";
import { AI_CONTRACTS } from "@/lib/ai/contracts";
import { CLAUDE_MODEL } from "@/lib/ai/client";
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
    const provenance = buildProvenance({
      generator: "learning.generate",
      model: CLAUDE_MODEL,
      promptContracts: [AI_CONTRACTS.learningPropose],
      sourceTypes: ["decision_review"],
    });

    const created = [];
    const versioned = [];
    const unchanged = [];
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

      // Evidence Reach V1 (Unit 5): one identity per (investor, family);
      // a repeated run writes nothing unless it cites a decision the
      // family's insight does not already cite (see the repository).
      const outcome = await upsertLearningInsightForFamily(
        db,
        ctx.investorId,
        family.family,
        validated,
        {
          decisionQualityPattern: computeDecisionQualityPattern(family.decisions),
          thesisAccuracyPattern: computeThesisAccuracyPattern(family.decisions),
        },
        reviewCaseKeys,
        provenance
      );
      if (outcome.action === "created") created.push({ insight: outcome.insight, version: outcome.version });
      else if (outcome.action === "versioned") versioned.push({ insight: outcome.insight, version: outcome.version });
      else unchanged.push({ insight: outcome.insight, version: outcome.version, wordingDiffers: outcome.wordingDiffers, proposedStatementText: outcome.proposedStatementText });
    }

    return {
      familiesConsidered: families.length,
      createdCount: created.length,
      versionedCount: versioned.length,
      unchangedCount: unchanged.length,
      droppedCount: families.length - created.length - versioned.length - unchanged.length,
      insights: created,
      newVersions: versioned,
      /** Families whose synthesis wrote nothing this run — with the proposed wording when it differs (reported, never silently dropped). */
      unchanged,
    };
  }),

  list: protectedProcedure.query(({ ctx }) => listLearningInsightsForInvestor(db, ctx.investorId)),

  evidence: protectedProcedure
    .input(z.object({ learningInsightId: z.string().uuid() }))
    .query(({ input }) => getEvidenceForLearningInsight(db, input.learningInsightId)),

  // "סגירת הלולאה ל-DNA" (docs/data-model.md §8) under Evidence Reach V1 /
  // OD-3: agreeing creates a new DNA hypothesis that CARRIES the insight's
  // cited decisions — one case per underlying Decision (several reviews of
  // one decision = one case), with the stance the agreed VERSION gave it —
  // represented by that decision's own investor-authored statements, each of
  // which must pass the same grounding gate every DNA citation passes
  // (src/lib/learning/carry-to-dna.ts): a review having cited a decision is
  // not textual grounding of the new claim. Counted through the shared
  // resolver under OD-2. The agreement adds zero cases; the insight and the
  // reviews themselves are not evidence. The agreement is recorded as a
  // resolved Correction; a repeated agree replays the first result before
  // any grounding call is made.
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

      // Replay first — a repeated agree must not re-run the grounding gate.
      const earlier = await findCarriedHypothesisForInsight(db, ctx.investorId, insight.id);
      if (earlier) return { correction: null, hypothesis: earlier.hypothesis, version: earlier.version, replayed: true, carried: null };

      const insightEvidence = await getEvidenceForLearningInsight(db, insight.id);
      const cited = citedReviewsOfVersion(latestVersion, insightEvidence);
      const reviewDecisionIds = await mapReviewIdsToDecisionIds(db, ctx.investorId, cited.map((c) => c.decisionReviewId));
      const cases = buildLearningCarryCases(cited, reviewDecisionIds);
      if (cases.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This insight cites no decision of yours — there is nothing to carry into DNA." });
      }
      const caseDecisionIds = new Set(cases.map((c) => c.decisionId));
      const statements = (await listDecisionStatementsForInvestor(db, ctx.investorId)).filter((s) => caseDecisionIds.has(s.decisionId));
      const grounding = await groundCarryCitations(latestVersion.statementText, cases, statements, checkEvidenceGrounding);
      if (grounding.citations.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "None of the cited decisions' own statements ground this insight — nothing can be carried into DNA.",
        });
      }
      const independence = await loadIndependenceResolver(db, ctx.investorId);
      const assessed = assessCitations(independence, grounding.citations);
      const provenance = buildProvenance({
        generator: "learning.agree_carry",
        model: CLAUDE_MODEL,
        promptContracts: [AI_CONTRACTS.evidenceGrounding],
        sourceTypes: ["decision_statement"],
        carriedFromLearningInsightId: insight.id,
        carriedFromLearningInsightVersionId: latestVersion.id,
      });

      const { hypothesis, version, replayed } = await carryLearningInsightToDna(db, {
        investorId: ctx.investorId,
        learningInsightId: insight.id,
        statementText: latestVersion.statementText,
        evidence: grounding.citations.map((c) => ({
          decisionId: c.decisionStatement.decisionId,
          kind: c.decisionStatement.kind,
          stance: c.stance,
          description: "הועבר מתובנת Learning שהסכמת לה; ההצהרה שכתבת בזמן ההחלטה נבדקה מול ניסוח ההשערה (grounding) — לא ההסכמה עצמה.",
        })),
        supportingCount: assessed.supportingCount,
        contradictingCount: assessed.contradictingCount,
        evidenceStrength: assessed.evidenceStrength,
        independenceBasis: assessed.independenceBasis,
        provenance,
      });
      const carried = {
        cases: cases.length,
        groundedCitations: grounding.citations.length,
        excludedCitations: grounding.excluded.length,
        decisionsWithoutStatements: grounding.decisionsWithoutStatements.length,
      };
      if (replayed) return { correction: null, hypothesis, version, replayed: true, carried };

      const pendingCorrection = await insertCorrection(db, {
        learningInsightId: insight.id,
        userArgumentText: input.note,
      });
      const correction = await markCorrectionResolved(db, pendingCorrection.id, {
        status: "led_to_new_version",
        resultingVersionId: version.id,
      });

      return { correction, hypothesis, version, replayed: false, carried };
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
