import { eq } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { decisions } from "@/db/schema";
import { listOpenReentryConditions } from "@/db/repositories/decisions";
import { listInvestmentCasesForInvestor } from "@/db/repositories/ideas-cases";
import { loadEpisodeJournal } from "@/lib/portfolio/load-episode-journal";
import { loadIndependenceContext } from "@/lib/evidence/load-independence-resolver";
import { loadEvidenceReach } from "@/lib/evidence/load-evidence-reach";
import { deriveNextActions, type NextAction } from "./next-actions";

// The one DB wrapper for deriveNextActions(). Reads only; every input is a
// persisted row or a derivation another feature already owns (the OD-2 case
// resolution from the independence loader, the journal's rationale status,
// the reach summary).
export async function loadNextActions(db: typeof Db, investorId: string, today: Date = new Date()): Promise<NextAction[]> {
  const [decisionRows, context, openConditions, cases, journal, reach] = await Promise.all([
    db.query.decisions.findMany({ where: eq(decisions.investorId, investorId), with: { reviews: { columns: { id: true } } } }),
    loadIndependenceContext(db, investorId),
    listOpenReentryConditions(db, investorId),
    listInvestmentCasesForInvestor(db, investorId),
    loadEpisodeJournal(db, investorId),
    loadEvidenceReach(db, investorId),
  ]);
  const resolutionById = new Map((context.decisions ?? []).map((d) => [d.id, d.caseResolution]));

  return deriveNextActions({
    today,
    decisions: decisionRows.map((d) => {
      const resolution = resolutionById.get(d.id);
      return {
        id: d.id,
        ticker: d.ticker,
        decisionType: d.decisionType,
        decisionDate: d.decisionDate,
        reviewByDate: d.reviewByDate,
        reviewCount: d.reviews.length,
        unclassifiedCandidateCount: resolution?.kind === "unresolved" ? resolution.candidateTransactionIds.length : 0,
      };
    }),
    openConditions: openConditions.map((c) => ({ predictionId: c.predictionId, decisionId: c.decisionId, ticker: c.ticker, decisionType: c.decisionType, checkableByDate: c.checkableByDate })),
    cases: cases.map((c) => ({ id: c.id, ticker: c.ticker, status: c.status, updatedAt: c.updatedAt })),
    episodes: journal.episodes.map((e) => ({ anchorable: e.entry !== null, hasRationale: e.rationale.status === "answered" })),
    reach: {
      dna: { uncitedStatements: reach.summary.dna.uncitedStatements, regenerationMayChangeReach: reach.summary.dna.regenerationMayChangeReach },
      strategy: { uncitedStatements: reach.summary.strategy.uncitedStatements, regenerationMayChangeReach: reach.summary.strategy.regenerationMayChangeReach },
    },
  });
}
