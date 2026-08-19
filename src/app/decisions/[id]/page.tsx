"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";

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

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">
            {decision.decisionType} {decision.ticker}
          </h1>
          <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
            Immutable snapshot
          </span>
        </div>
        <p className="text-xs text-neutral-500">
          Decided {new Date(decision.decisionDate).toLocaleString()} · price at decision $
          {Number(snapshot.priceAtDecision).toFixed(2)}
          {snapshot.size ? ` · size $${Number(snapshot.size).toFixed(2)}` : ""}
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded border border-neutral-200 p-4 text-sm">
        <TextBlock label="Your reasoning & thesis (verbatim)" text={snapshot.userReasoningText} />
        <TextBlock label="AI's interpretation of your thesis" text={snapshot.thesis?.aiInterpretationText ?? null} />
        <TextBlock label="AI real-time assessment" text={snapshot.aiRealtimeAssessmentText} />
        <TextBlock label="Risks considered" text={snapshot.risksConsideredText} />
        <TextBlock label="Exit conditions" text={snapshot.exitConditionsText} />
      </section>

      {predictions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Predictions extracted from your thesis</h2>
          <ul className="flex flex-col gap-2">
            {predictions.map((p) => (
              <li key={p.id} className="rounded border border-neutral-200 p-3 text-sm">
                <p>{p.claimText}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {p.status}
                  {p.checkableByDate ? ` · checkable by ${new Date(p.checkableByDate).toLocaleDateString()}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Portfolio state at decision time</h2>
        <p className="text-sm">Cash: ${portfolioState.cash.toFixed(2)}</p>
        {portfolioState.positions.length > 0 ? (
          <ul className="text-sm text-neutral-600">
            {portfolioState.positions.map((p) => (
              <li key={p.ticker}>
                {p.ticker}: {p.quantity} shares @ avg cost $
                {p.costBasisPerShare?.toFixed(2) ?? "unknown"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">No other holdings at the time.</p>
        )}
      </section>

      {marketContext && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Market context at decision time</h2>
          <p className="text-sm text-neutral-600">
            S&P 500: {Number(marketContext.indexLevel).toFixed(2)} (
            {Number(marketContext.indexChange1d) >= 0 ? "+" : ""}
            {Number(marketContext.indexChange1d).toFixed(2)}% that day)
            {marketContext.volatilityIndexValue !== null &&
              ` · VIX ${Number(marketContext.volatilityIndexValue).toFixed(2)}`}
          </p>
        </section>
      )}

      {snapshot.dnaReferences.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">DNA hypotheses in effect at decision time</h2>
          <ul className="flex flex-col gap-1 text-sm text-neutral-600">
            {snapshot.dnaReferences.map((ref) => (
              <li key={ref.dnaHypothesisVersionId}>
                ({ref.dnaHypothesisVersion.evidenceStrength}) {ref.dnaHypothesisVersion.statementText}
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
      <section className="flex flex-col gap-3 border-t border-neutral-200 pt-6">
        <h2 className="text-sm font-semibold">Later Context</h2>
        <p className="text-xs text-neutral-500">
          Add clarifications or corrections without rewriting the record above — useful if the AI
          real-time assessment or a prediction turned out to contain a mistake. Shown to Decision
          Review as authoritative over anything it corrects.
        </p>
        {laterContexts.data?.map((lc) => (
          <div key={lc.id} className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <p className="text-xs text-neutral-400">
              {new Date(lc.addedAt).toLocaleString()} · added by {lc.addedBy}
            </p>
            <p className="mt-1">{lc.text}</p>
          </div>
        ))}
        <textarea
          value={laterContextDraft}
          onChange={(e) => setLaterContextDraft(e.target.value)}
          placeholder="e.g. Correction: the AI real-time assessment above confused position size with per-share price..."
          className="min-h-20 rounded border border-neutral-300 p-2 text-sm"
        />
        <button
          onClick={() => guard(() => addLaterContext.mutateAsync({ decisionId: id, text: laterContextDraft }))}
          disabled={laterContextDraft.trim() === "" || addLaterContext.isPending}
          className="w-fit rounded border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50"
        >
          {addLaterContext.isPending ? "Adding..." : "Add Later Context"}
        </button>
        {addLaterContext.isError && <p className="text-sm text-red-600">{addLaterContext.error.message}</p>}
      </section>

      {/* Decision Review */}
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

function TextBlock({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-neutral-700">{text}</p>
    </div>
  );
}
