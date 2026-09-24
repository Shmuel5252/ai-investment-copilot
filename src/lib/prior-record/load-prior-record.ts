// The one DB wrapper for derivePriorRecordBrief() (prior-record.ts). Every
// caller — the research page's cases.priorRecord query and the moment a
// decision is recorded (decisions.create, which freezes the result into the
// new DecisionSnapshot) — goes through here. Reads only, all scoped to the
// investor AND the ticker; no AI, no market data. The accounting is allowed
// to fail: that becomes accounting="unavailable" and the brief still shows
// the decision record, never a guessed position.
import { and, eq } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { decisions } from "@/db/schema";
import { loadEpisodeJournalWithPortfolio } from "@/lib/portfolio/load-episode-journal";
import type { JournalEpisode } from "@/lib/portfolio/episodes";
import { derivePriorRecordBrief, isAnswerKnownAt, isTransactionKnownAt, normalizeTicker, type PriorRecordBrief } from "./prior-record";

export async function loadPriorRecordBrief(
  db: typeof Db,
  params: {
    investorId: string;
    ticker: string;
    excludeInvestmentCaseId?: string;
    /** Recording time (default: now). */
    now?: Date;
    /** Information cutoff (default: now). decisions.create passes the decision's effective time. */
    asOf?: Date;
  }
): Promise<PriorRecordBrief> {
  const ticker = normalizeTicker(params.ticker);
  const now = params.now ?? new Date();
  const asOf = params.asOf && params.asOf.getTime() < now.getTime() ? params.asOf : now;
  const [decisionRows] = await Promise.all([
    db.query.decisions.findMany({
      where: and(eq(decisions.investorId, params.investorId), eq(decisions.ticker, ticker)),
      with: {
        snapshot: { with: { thesis: { with: { predictions: true } } } },
        reviews: true,
        laterContexts: true,
      },
    }),
  ]);

  let accounting: "ok" | "unavailable" = "ok";
  let episodes: JournalEpisode[] = [];
  let position: { quantity: number; costBasisPerShare: number | null } | null = null;
  let tickerWarningCount = 0;
  let historyThrough: Date | null = null;
  try {
    const { journal, portfolio, transactions } = await loadEpisodeJournalWithPortfolio(db, params.investorId, {
      asOf,
      includeTransaction: (row) => isTransactionKnownAt(row, asOf),
      includeAnswer: (a) => isAnswerKnownAt(a, asOf),
    });
    // Freshness of exactly the rows the brief could see — never the global latest.
    historyThrough = transactions.reduce<Date | null>((m, t) => (m === null || t.transactionDate > m ? t.transactionDate : m), null);
    episodes = journal.episodes;
    const p = portfolio.positions.find((x) => x.ticker === ticker);
    position = p ? { quantity: p.quantity, costBasisPerShare: p.costBasisPerShare } : null;
    tickerWarningCount = portfolio.warnings.filter((w) => w.ticker === ticker).length;
  } catch {
    accounting = "unavailable";
  }

  return derivePriorRecordBrief({
    ticker,
    generatedAt: now,
    asOf,
    historyLatestTransactionDate: historyThrough,
    accounting,
    tickerWarningCount,
    position,
    episodes,
    excludeInvestmentCaseId: params.excludeInvestmentCaseId,
    decisions: decisionRows.map((d) => ({
      id: d.id,
      investmentCaseId: d.investmentCaseId,
      decisionType: d.decisionType,
      decisionDate: d.decisionDate,
      createdAt: d.createdAt,
      reviewByDate: d.reviewByDate,
      snapshot: d.snapshot
        ? {
            priceAtDecision: d.snapshot.priceAtDecision,
            size: d.snapshot.size,
            userReasoningText: d.snapshot.userReasoningText,
            risksConsideredText: d.snapshot.risksConsideredText,
            exitConditionsText: d.snapshot.exitConditionsText,
            predictions: (d.snapshot.thesis?.predictions ?? []).map((p) => ({
              id: p.id,
              claimText: p.claimText,
              kind: p.kind,
              status: p.status,
              checkableByDate: p.checkableByDate,
              resolvedAt: p.resolvedAt,
              resolutionNote: p.resolutionNote,
              createdAt: p.createdAt,
            })),
          }
        : null,
      reviews: d.reviews.map((r) => ({ id: r.id, reviewDate: r.reviewDate, decisionQualityOverall: r.decisionQualityOverall, thesisAccuracy: r.thesisAccuracy })),
      laterContexts: d.laterContexts.map((lc) => ({ id: lc.id, addedAt: lc.addedAt, text: lc.text })),
    })),
  });
}
