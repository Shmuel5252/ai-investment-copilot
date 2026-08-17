"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/trpc/react";
import type { MarketIntelligence } from "@/lib/market/fmp";
import type { PortfolioFit } from "@/lib/portfolio/portfolio-fit";
import { useSubmitGuard } from "@/lib/use-submit-guard";

interface PersonalFitEvidenceRefs {
  dnaHypothesisIds: string[];
  strategyPrincipleIds: string[];
  hasTraceableEvidence: boolean;
}

const DECISION_TYPES = ["BUY", "ADD", "HOLD", "REDUCE", "SELL", "PASS"] as const;

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();

  const caseQuery = trpc.cases.get.useQuery({ caseId: id });
  const dnaList = trpc.dna.list.useQuery();
  const strategyList = trpc.strategy.list.useQuery();
  const existingDecision = trpc.decisions.getForCase.useQuery({ caseId: id });

  const fetchMarketData = trpc.cases.fetchMarketIntelligence.useMutation({
    onSuccess: () => utils.cases.get.invalidate({ caseId: id }),
  });
  const generatePersonalFit = trpc.cases.generatePersonalFit.useMutation({
    onSuccess: () => utils.cases.get.invalidate({ caseId: id }),
  });
  const generateSynthesis = trpc.cases.generateSynthesis.useMutation({
    onSuccess: () => utils.cases.get.invalidate({ caseId: id }),
  });
  const computeFit = trpc.cases.computePortfolioFit.useMutation();
  const recordDecision = trpc.decisions.create.useMutation({
    onSuccess: (result) => router.push(`/decisions/${result.decision.id}`),
  });

  const [sizeDollars, setSizeDollars] = useState("");
  const [decisionType, setDecisionType] = useState<(typeof DECISION_TYPES)[number]>("BUY");
  const [reasoningText, setReasoningText] = useState("");
  const [risksConsideredText, setRisksConsideredText] = useState("");
  const [exitConditionsText, setExitConditionsText] = useState("");

  if (caseQuery.isLoading) return <main className="p-12 text-sm">Loading...</main>;
  if (!caseQuery.data) return <main className="p-12 text-sm text-red-600">Case not found.</main>;

  const investmentCase = caseQuery.data;
  const intelligence = investmentCase.marketIntelligenceJson as MarketIntelligence | null;
  const evidenceRefs = investmentCase.personalFitEvidenceRefs as PersonalFitEvidenceRefs | null;

  const dnaById = new Map((dnaList.data ?? []).map((h) => [h.id, h.versions[0]?.statementText]));
  const strategyById = new Map(
    (strategyList.data?.principles ?? []).map((p) => [p.id, p.versions[0]?.statementText])
  );

  const parsedSize = sizeDollars.trim() === "" ? undefined : Number(sizeDollars);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold">{investmentCase.ticker}</h1>
        <p className="text-xs text-neutral-500">
          {investmentCase.status} · created {new Date(investmentCase.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Market Intelligence */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Market Intelligence — Financial Modeling Prep</h2>
        <button
          onClick={() => guard(() => fetchMarketData.mutateAsync({ caseId: id, forceRefresh: !!intelligence }), "fetchMarketData")}
          disabled={fetchMarketData.isPending}
          className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {fetchMarketData.isPending
            ? "Fetching..."
            : intelligence
              ? "Refresh market data"
              : "Fetch market data"}
        </button>
        {fetchMarketData.isError && <p className="text-sm text-red-600">{fetchMarketData.error.message}</p>}
        {intelligence && (
          <div className="rounded border border-neutral-200 p-4 text-sm">
            <p className="font-medium">
              {intelligence.companyName} — ${intelligence.price.toFixed(2)}{" "}
              <span className={intelligence.changePercentage >= 0 ? "text-green-700" : "text-red-700"}>
                ({intelligence.changePercentage >= 0 ? "+" : ""}
                {intelligence.changePercentage.toFixed(2)}%)
              </span>
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {intelligence.sector ?? "Unknown sector"} · {intelligence.industry ?? "Unknown industry"} · Market
              cap ${intelligence.marketCap.toLocaleString()} · Beta {intelligence.beta ?? "n/a"} · 52w range{" "}
              {intelligence.fiftyTwoWeekRange ?? "n/a"}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {intelligence.valuationRatiosAvailable
                ? `P/E ${intelligence.peRatioTtm?.toFixed(2)} · P/B ${intelligence.priceToBookRatioTtm?.toFixed(2)} · P/S ${intelligence.priceToSalesRatioTtm?.toFixed(2)} · Div yield ${intelligence.dividendYieldTtm ?? "n/a"}`
                : "Valuation ratios unavailable on the current data plan for this ticker."}
            </p>
            {intelligence.description && (
              <p className="mt-2 text-xs text-neutral-600">{intelligence.description}</p>
            )}
            <p className="mt-2 text-xs text-neutral-400">
              Fetched {new Date(intelligence.fetchedAt).toLocaleString()}
            </p>
          </div>
        )}
      </section>

      {/* Portfolio Fit */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Portfolio Fit — computed live, not stored</h2>
        <div className="flex gap-2">
          <input
            value={sizeDollars}
            onChange={(e) => setSizeDollars(e.target.value)}
            placeholder="Hypothetical size in $ (optional)"
            className="rounded border border-neutral-300 p-2 text-sm"
          />
          <button
            onClick={() => guard(() => computeFit.mutateAsync({ caseId: id, sizeDollars: parsedSize }), "computeFit")}
            disabled={!intelligence || computeFit.isPending}
            className="rounded border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            {computeFit.isPending ? "Computing..." : "Compute portfolio fit"}
          </button>
        </div>
        {!intelligence && <p className="text-xs text-neutral-500">Fetch market data first.</p>}
        {computeFit.isError && <p className="text-sm text-red-600">{computeFit.error.message}</p>}
        {computeFit.data && <PortfolioFitView fit={computeFit.data} />}
      </section>

      {/* Personal Fit */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Personal Fit — vs. your DNA + Strategy</h2>
        <button
          onClick={() => guard(() => generatePersonalFit.mutateAsync({ caseId: id }), "generatePersonalFit")}
          disabled={generatePersonalFit.isPending}
          className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {generatePersonalFit.isPending ? "Assessing..." : "Generate personal fit"}
        </button>
        {generatePersonalFit.isError && (
          <p className="text-sm text-red-600">{generatePersonalFit.error.message}</p>
        )}
        {investmentCase.personalFitText && (
          <div className="rounded border border-neutral-200 p-4 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p>{investmentCase.personalFitText}</p>
              {!evidenceRefs?.hasTraceableEvidence && (
                <span className="shrink-0 rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                  Insufficient Evidence
                </span>
              )}
            </div>
            {evidenceRefs && evidenceRefs.hasTraceableEvidence && (
              <ul className="mt-2 flex flex-col gap-1 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
                {evidenceRefs.dnaHypothesisIds.map((refId) => (
                  <li key={refId}>[DNA] {dnaById.get(refId) ?? refId}</li>
                ))}
                {evidenceRefs.strategyPrincipleIds.map((refId) => (
                  <li key={refId}>[Strategy] {strategyById.get(refId) ?? refId}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Case Synthesis */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Case Synthesis</h2>
        <button
          onClick={() => guard(() => generateSynthesis.mutateAsync({ caseId: id, sizeDollars: parsedSize }), "generateSynthesis")}
          disabled={!intelligence || generateSynthesis.isPending}
          className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {generateSynthesis.isPending ? "Synthesizing..." : "Generate synthesis"}
        </button>
        {!intelligence && <p className="text-xs text-neutral-500">Fetch market data first.</p>}
        {generateSynthesis.isError && <p className="text-sm text-red-600">{generateSynthesis.error.message}</p>}

        {investmentCase.synthesisText && (
          <div className="flex flex-col gap-3 rounded border border-neutral-200 p-4 text-sm">
            <p className="font-medium">{investmentCase.synthesisText}</p>
            <TextBlock label="Bull case" text={investmentCase.bullCaseText} />
            <TextBlock label="Bear case" text={investmentCase.bearCaseText} />
            <TextBlock label="Catalysts" text={investmentCase.catalystsText} />
            <TextBlock label="Invalidation conditions" text={investmentCase.invalidationConditionsText} />
            <TextBlock label="Portfolio fit (narrative)" text={investmentCase.portfolioFitText} />
            <TextBlock label="Market blindspot" text={investmentCase.marketBlindspotText} />
            <TextBlock label="Devil's advocate" text={investmentCase.devilsAdvocateText} />
          </div>
        )}
      </section>

      {/* Record Decision */}
      <section className="flex flex-col gap-3 border-t border-neutral-200 pt-6">
        <h2 className="text-sm font-semibold">Record Decision</h2>

        {existingDecision.data ? (
          <p className="text-sm">
            Decision already recorded for this case —{" "}
            <Link href={`/decisions/${existingDecision.data.id}`} className="underline">
              view the Decision Snapshot
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-xs text-neutral-500">
              Freezes price, portfolio state, market context, and the Strategy/DNA versions in effect
              right now, together with your reasoning — permanently. Nothing here can be edited
              afterward, only added to later as Later Context.
            </p>
            <select
              value={decisionType}
              onChange={(e) => setDecisionType(e.target.value as (typeof DECISION_TYPES)[number])}
              className="w-fit rounded border border-neutral-300 p-2 text-sm"
            >
              {DECISION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={sizeDollars}
              onChange={(e) => setSizeDollars(e.target.value)}
              placeholder="Size in $ (optional)"
              className="rounded border border-neutral-300 p-2 text-sm"
            />
            <textarea
              value={reasoningText}
              onChange={(e) => setReasoningText(e.target.value)}
              placeholder="Your reasoning and thesis — why this decision, what do you believe will happen?"
              className="min-h-24 rounded border border-neutral-300 p-2 text-sm"
            />
            <textarea
              value={risksConsideredText}
              onChange={(e) => setRisksConsideredText(e.target.value)}
              placeholder="Risks you considered (optional)"
              className="min-h-16 rounded border border-neutral-300 p-2 text-sm"
            />
            <textarea
              value={exitConditionsText}
              onChange={(e) => setExitConditionsText(e.target.value)}
              placeholder="Exit conditions — what would change your mind? (optional)"
              className="min-h-16 rounded border border-neutral-300 p-2 text-sm"
            />
            <button
              onClick={() =>
                guard(
                  () =>
                    recordDecision.mutateAsync({
                      caseId: id,
                      decisionType,
                      sizeDollars: parsedSize,
                      reasoningText,
                      risksConsideredText: risksConsideredText.trim() || undefined,
                      exitConditionsText: exitConditionsText.trim() || undefined,
                    }),
                  "recordDecision"
                )
              }
              disabled={reasoningText.trim() === "" || recordDecision.isPending}
              className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {recordDecision.isPending ? "Recording..." : `Record ${decisionType} — permanent`}
            </button>
            {recordDecision.isError && (
              <p className="text-sm text-red-600">{recordDecision.error.message}</p>
            )}
          </>
        )}
      </section>
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

function PortfolioFitView({ fit }: { fit: PortfolioFit }) {
  return (
    <div className="rounded border border-neutral-200 p-4 text-sm">
      <p>
        Total portfolio value: ${fit.totalPortfolioValueUsd.toFixed(2)}
        {fit.totalPortfolioValueApproximate ? " (approximate)" : ""}
      </p>
      <p>
        Existing exposure: {fit.existingHoldingQuantity} shares · ${fit.existingPositionValueUsd.toFixed(2)} ·{" "}
        {fit.existingWeightPercent.toFixed(1)}% of portfolio
      </p>
      {fit.projectedWeightPercent !== null && (
        <p>
          Projected: ${fit.projectedPositionValueUsd?.toFixed(2)} · {fit.projectedWeightPercent.toFixed(1)}% of
          portfolio
        </p>
      )}
      <p className="text-xs text-neutral-500">
        {fit.holdingsCount} current holding(s)
        {fit.largestCurrentPositionTicker
          ? ` · largest: ${fit.largestCurrentPositionTicker} (${fit.largestCurrentPositionWeightPercent?.toFixed(1)}%)`
          : ""}
      </p>
      {fit.warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-amber-700">
          {fit.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
