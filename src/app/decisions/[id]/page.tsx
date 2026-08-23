"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import {
  decisionTypeLabel,
  evidenceStrengthLabel,
  predictionStatusLabel,
  predictionKindLabel,
  addedByLabel,
  common,
  nav,
  decisionSnapshot as t,
  laterContext as tLater,
} from "@/lib/i18n/strings";

// Direction A ("יומן אנליטי") typography — scoped to this page only
// (next/font preloads per-route, not globally; see docs/architecture.md
// UI redesign task notes). Decision Review further down keeps its
// original default font via .legacy-scope in globals.css.
const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

interface FrozenPortfolioState {
  cash: number;
  positions: { ticker: string; quantity: number; costBasisPerShare: number | null }[];
}

interface DecisionOutcome {
  priceAtDecision: number;
  currentPrice: number | null;
  priceChangePercent: number | null;
  sizeDollars: number | null;
  positionValueNowUsd: number | null;
  pnlUsd: number | null;
  pnlPercent: number | null;
  stillHeld: boolean;
  asOfDate: string;
}

// Decision Review only, below — untouched, still English.
const QUALITY_COLOR: Record<string, string> = {
  insufficient_evidence: "bg-neutral-200 text-neutral-600",
  weak: "bg-amber-100 text-amber-800",
  reasonable: "bg-blue-100 text-blue-800",
  strong: "bg-green-100 text-green-800",
};

const DIMENSION_LABEL: Record<string, string> = {
  thesis_quality: "Thesis Quality",
  evidence_quality: "Evidence Quality",
  risk_awareness: "Risk Awareness",
  valuation_awareness: "Valuation Awareness",
  portfolio_fit: "Portfolio Fit",
  strategy_consistency: "Strategy Consistency",
  exit_conditions: "Exit Conditions",
};

type PredictionStatus = "confirmed" | "refuted" | "inconclusive";

export default function DecisionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const query = trpc.decisions.get.useQuery({ decisionId: id });
  const pendingPredictions = trpc.reviews.pendingPredictions.useQuery({ decisionId: id });
  const reviews = trpc.reviews.listForDecision.useQuery({ decisionId: id });
  const laterContexts = trpc.decisions.listLaterContext.useQuery({ decisionId: id });

  const generateReview = trpc.reviews.generate.useMutation({
    onSuccess: () => {
      utils.reviews.listForDecision.invalidate({ decisionId: id });
      utils.reviews.pendingPredictions.invalidate({ decisionId: id });
      setResolutions({});
    },
  });
  const submitCorrection = trpc.reviews.correct.useMutation({
    onSuccess: () => setCorrectingId(null),
  });
  const addLaterContext = trpc.decisions.addLaterContext.useMutation({
    onSuccess: () => {
      utils.decisions.listLaterContext.invalidate({ decisionId: id });
      setLaterContextDraft("");
    },
  });

  const [resolutions, setResolutions] = useState<Record<string, { status: PredictionStatus; note: string }>>({});
  const [showCounterfactual, setShowCounterfactual] = useState(false);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [laterContextDraft, setLaterContextDraft] = useState("");

  if (query.isLoading) return <main className="p-12 text-sm">Loading...</main>;
  if (!query.data || !query.data.snapshot) {
    return <main className="p-12 text-sm text-red-600">Decision snapshot not found.</main>;
  }

  const { decision, snapshot, predictions, marketContext } = query.data;
  const portfolioState = snapshot.portfolioStateJson as FrozenPortfolioState;
  const decidedDate = new Date(decision.decisionDate).toLocaleString("he-IL");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      {/* Decision Snapshot — Direction A ("יומן אנליטי"), Hebrew/RTL.
          Everything in this wrapper, including Later Context, is in
          scope for the redesign. Decision Review below is not: see the
          wrapper further down. */}
      <div dir="rtl" lang="he" className={`${sansBody.className} flex flex-col gap-8 text-journal-ink`}>
        <BackLink href="/decisions" label={nav.allDecisions} />

        <div className="flex flex-col gap-2 border-b border-journal-rule pb-6">
          <div className="flex items-center gap-2">
            <h1 className={`${serifHeader.className} text-2xl font-bold`}>
              {decisionTypeLabel[decision.decisionType] ?? decision.decisionType} {decision.ticker}
            </h1>
            <span className="rounded border border-journal-rule px-2 py-0.5 text-xs text-journal-muted">
              {t.immutableBadge}
            </span>
          </div>
          <p className="text-xs text-journal-muted">
            {t.decidedOnLabel}-<Num>{decidedDate}</Num> · {t.priceAtDecisionLabel}:{" "}
            <Num>${Number(snapshot.priceAtDecision).toFixed(2)}</Num>
            {snapshot.size ? (
              <>
                {" "}
                · {t.sizeLabel}: <Num>${Number(snapshot.size).toFixed(2)}</Num>
              </>
            ) : null}
          </p>
        </div>

        <section className="flex flex-col gap-4 rounded border border-journal-rule bg-journal-surface p-5 text-sm">
          <TextBlock label={t.reasoningLabel} text={snapshot.userReasoningText} />
          <TextBlock label={t.aiInterpretationLabel} text={snapshot.thesis?.aiInterpretationText ?? null} />
          <TextBlock label={t.aiAssessmentLabel} text={snapshot.aiRealtimeAssessmentText} />
          <TextBlock label={t.risksLabel} text={snapshot.risksConsideredText} />
          <TextBlock label={t.exitConditionsLabel} text={snapshot.exitConditionsText} />
        </section>

        {predictions.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t.predictionsTitle}</h2>
            <ul className="flex flex-col gap-2">
              {predictions.map((p) => (
                <li key={p.id} className="rounded border border-journal-rule bg-journal-surface p-3 text-sm">
                  {p.kind && (
                    <p className="mb-1 text-xs text-journal-accent">{predictionKindLabel[p.kind] ?? p.kind}</p>
                  )}
                  <p>{p.claimText}</p>
                  <p className="mt-1 text-xs text-journal-muted">
                    {predictionStatusLabel[p.status] ?? p.status}
                    {p.checkableByDate ? (
                      <>
                        {" "}
                        · {t.checkableByLabel} <Num>{new Date(p.checkableByDate).toLocaleDateString("he-IL")}</Num>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{t.portfolioStateTitle}</h2>
          <p className="text-sm">
            {common.cashLabel}: <Num>${portfolioState.cash.toFixed(2)}</Num>
          </p>
          {portfolioState.positions.length > 0 ? (
            <ul className="text-sm text-journal-muted">
              {portfolioState.positions.map((p) => (
                <li key={p.ticker}>
                  {p.ticker}: <Num>{p.quantity}</Num> {common.sharesLabel} · {common.avgCostLabel}{" "}
                  {p.costBasisPerShare !== null ? (
                    <Num>${p.costBasisPerShare.toFixed(2)}</Num>
                  ) : (
                    common.costUnknown
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-journal-muted">{t.noOtherHoldings}</p>
          )}
        </section>

        {marketContext && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t.marketContextTitle}</h2>
            {/* Only the parenthetical signed percentage is isolated here,
                not "S&P 500: X" or "VIX X" — those stay one continuous
                run with their own Latin label, which already resolves
                correctly on its own (confirmed live). Isolating the
                trailing number too split it from its label and let the
                two get reordered relative to each other — a Num should
                wrap a bare value after a Hebrew label, or a whole
                "Label: value" cluster after a Latin label, never just
                the tail end of an already-Latin-anchored run. */}
            <p className="text-sm text-journal-muted">
              S&P 500: {Number(marketContext.indexLevel).toFixed(2)} (
              <Num>
                {Number(marketContext.indexChange1d) >= 0 ? "+" : ""}
                {Number(marketContext.indexChange1d).toFixed(2)}%
              </Num>{" "}
              {t.onThatDay})
              {marketContext.volatilityIndexValue !== null &&
                ` · VIX ${Number(marketContext.volatilityIndexValue).toFixed(2)}`}
            </p>
          </section>
        )}

        {snapshot.dnaReferences.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t.dnaHypothesesTitle}</h2>
            {/* Statement and evidence strength as separate block lines,
                not one inline "(label) statement" sentence — a live
                check showed the Hebrew label drift to the end of the
                first line when the statement (often written in English,
                verbatim) was long enough to wrap, a bidi artifact of
                mixing a short RTL prefix with a long LTR run. */}
            <ul className="flex flex-col gap-3 text-sm">
              {snapshot.dnaReferences.map((ref) => (
                <li key={ref.dnaHypothesisVersionId} className="flex flex-col gap-0.5">
                  <p className="text-journal-ink">{ref.dnaHypothesisVersion.statementText}</p>
                  <p className="text-xs text-journal-accent">
                    Evidence Strength:{" "}
                    {evidenceStrengthLabel[ref.dnaHypothesisVersion.evidenceStrength] ??
                      ref.dnaHypothesisVersion.evidenceStrength}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Later Context — additions after the fact, never edits to the
            immutable snapshot above (docs/CLAUDE.md Historical Integrity:
            Original Snapshot -> Later Context -> Review). Feeds directly
            into Decision Review's AI reasoning as an authoritative
            correction wherever it conflicts with the frozen text. */}
        <section className="flex flex-col gap-3 border-t border-journal-rule pt-6">
          <h2 className="text-sm font-semibold">{tLater.title}</h2>
          <p className="text-xs text-journal-muted">{tLater.explanation}</p>
          {laterContexts.data?.map((lc) => (
            <div key={lc.id} className="rounded border border-journal-rule bg-journal-bg p-3 text-sm">
              <p className="text-xs text-journal-muted">
                <Num>{new Date(lc.addedAt).toLocaleString("he-IL")}</Num> · {tLater.addedByPrefix}{" "}
                {addedByLabel[lc.addedBy] ?? lc.addedBy}
              </p>
              <p className="mt-1">{lc.text}</p>
            </div>
          ))}
          <textarea
            value={laterContextDraft}
            onChange={(e) => setLaterContextDraft(e.target.value)}
            placeholder={tLater.placeholder}
            className="min-h-20 rounded border border-journal-rule bg-journal-surface p-2 text-sm"
          />
          <button
            onClick={() => guard(() => addLaterContext.mutateAsync({ decisionId: id, text: laterContextDraft }))}
            disabled={laterContextDraft.trim() === "" || addLaterContext.isPending}
            className="w-fit rounded border border-journal-rule px-3 py-2 text-sm text-journal-ink hover:bg-journal-bg disabled:opacity-50"
          >
            {addLaterContext.isPending ? tLater.addingButton : tLater.addButton}
          </button>
          {addLaterContext.isError && <p className="text-sm text-red-600">{addLaterContext.error.message}</p>}
        </section>
      </div>

      {/* Decision Review — explicitly out of scope for this redesign pass
          (open backlog items: forecast vs. re-entry-condition
          distinction, sector concentration — see docs/backlog.md).
          dir="ltr" + .legacy-scope (globals.css) pin its exact current
          look regardless of the Hebrew/RTL wrapper above or any future
          global token change, without touching a single line inside. */}
      <div dir="ltr" lang="en" className="legacy-scope">
        <section className="flex flex-col gap-4 border-t border-neutral-200 pt-6">
          <h2 className="text-sm font-semibold">Decision Review</h2>

          {(pendingPredictions.data?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-3 rounded border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs text-amber-800">
                Resolve what actually happened with these predictions before running a review — this is
                your own judgment, not something the system infers.
              </p>
              {pendingPredictions.data!.map((p) => (
                <div key={p.id} className="flex flex-col gap-1">
                  {p.kind && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      {p.kind === "reentry_condition" ? "Re-entry condition (not a forecast)" : "Forecast"}
                    </p>
                  )}
                  <p className="text-sm">{p.claimText}</p>
                  <div className="flex gap-2">
                    {(["confirmed", "refuted", "inconclusive"] as const).map((status) => (
                      <button
                        key={status}
                        onClick={() =>
                          setResolutions((r) => ({
                            ...r,
                            [p.id]: { status, note: r[p.id]?.note ?? "" },
                          }))
                        }
                        className={`rounded border px-2 py-1 text-xs ${
                          resolutions[p.id]?.status === status
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : "border-neutral-300"
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                  <input
                    value={resolutions[p.id]?.note ?? ""}
                    onChange={(e) =>
                      setResolutions((r) => ({
                        ...r,
                        [p.id]: { status: r[p.id]?.status ?? "inconclusive", note: e.target.value },
                      }))
                    }
                    placeholder="Brief note on what actually happened"
                    className="rounded border border-neutral-300 p-1 text-xs"
                  />
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() =>
              guard(() =>
                generateReview.mutateAsync({
                  decisionId: id,
                  predictionResolutions: Object.entries(resolutions)
                    .filter(([, v]) => v.status && v.note.trim() !== "")
                    .map(([predictionId, v]) => ({ predictionId, status: v.status, note: v.note.trim() })),
                })
              )
            }
            disabled={
              generateReview.isPending ||
              (pendingPredictions.data ?? []).some((p) => !resolutions[p.id]?.status || resolutions[p.id]?.note.trim() === "")
            }
            className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {generateReview.isPending ? "Reviewing..." : "Run Review"}
          </button>
          {generateReview.isError && <p className="text-sm text-red-600">{generateReview.error.message}</p>}

          {reviews.data?.map((review) => (
            <div key={review.id} className="flex flex-col gap-3 rounded border border-neutral-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-neutral-500">{new Date(review.reviewDate).toLocaleString()}</p>
                <div className="flex gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${QUALITY_COLOR[review.decisionQualityOverall]}`}>
                    Quality: {review.decisionQualityOverall}
                  </span>
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                    Thesis: {review.thesisAccuracy}
                  </span>
                </div>
              </div>

              <p className="text-sm">{review.narrativeSummaryText}</p>

              {decision.decisionType === "PASS" ? (
                <button onClick={() => setShowCounterfactual((s) => !s)} className="w-fit text-xs underline">
                  {showCounterfactual ? "Hide" : "Show"} what happened to the price since
                </button>
              ) : (
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Outcome</p>
              )}
              {(decision.decisionType !== "PASS" || showCounterfactual) && (
                <OutcomeView outcome={review.outcomeJson as DecisionOutcome} />
              )}

              <details className="text-sm">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  7-dimension drill-down
                </summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {review.dimensions.map((dim) => (
                    <li key={dim.id} className="rounded border border-neutral-100 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{DIMENSION_LABEL[dim.dimension] ?? dim.dimension}</span>
                        <span className={`rounded px-2 py-0.5 text-xs ${QUALITY_COLOR[dim.verdict]}`}>
                          {dim.verdict}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-600">{dim.rationaleText}</p>
                      {correctingId === dim.id ? (
                        <div className="mt-2 flex flex-col gap-1">
                          <textarea
                            value={correctionText}
                            onChange={(e) => setCorrectionText(e.target.value)}
                            placeholder="Why do you disagree with this verdict?"
                            className="rounded border border-neutral-300 p-1 text-xs"
                          />
                          <button
                            onClick={() =>
                              guard(
                                () =>
                                  submitCorrection.mutateAsync({
                                    reviewDimensionId: dim.id,
                                    userArgumentText: correctionText,
                                  }),
                                dim.id
                              )
                            }
                            disabled={correctionText.trim() === "" || submitCorrection.isPending}
                            className="w-fit rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
                          >
                            Submit disagreement
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setCorrectingId(dim.id);
                            setCorrectionText("");
                          }}
                          className="mt-1 text-xs text-red-600 underline"
                        >
                          Disagree
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}
          {reviews.data?.length === 0 && (
            <p className="text-sm text-neutral-500">No review yet — run one above.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function OutcomeView({ outcome }: { outcome: DecisionOutcome }) {
  return (
    <div className="rounded border border-neutral-100 bg-neutral-50 p-3 text-xs text-neutral-700">
      <p>
        Price then ${outcome.priceAtDecision.toFixed(2)} → now{" "}
        {outcome.currentPrice !== null ? `$${outcome.currentPrice.toFixed(2)}` : "unavailable"}
        {outcome.priceChangePercent !== null &&
          ` (${outcome.priceChangePercent >= 0 ? "+" : ""}${outcome.priceChangePercent.toFixed(1)}%)`}
      </p>
      {outcome.sizeDollars !== null && outcome.pnlUsd !== null && (
        <p>
          P&L: ${outcome.pnlUsd.toFixed(2)} ({outcome.pnlPercent?.toFixed(1)}%)
        </p>
      )}
      <p>{outcome.stillHeld ? "Still held today." : "Not currently held."}</p>
    </div>
  );
}

// Decision Snapshot only (Later Context/Review sections don't use this).
function TextBlock({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-journal-muted">{label}</p>
      <p className="mt-1 leading-relaxed text-journal-ink">{text}</p>
    </div>
  );
}
