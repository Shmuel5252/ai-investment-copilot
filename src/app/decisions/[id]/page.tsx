"use client";

import { useParams } from "next/navigation";
import { trpc } from "@/trpc/react";

interface FrozenPortfolioState {
  cash: number;
  positions: { ticker: string; quantity: number; costBasisPerShare: number | null }[];
}

export default function DecisionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = trpc.decisions.get.useQuery({ decisionId: id });

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
    </main>
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
