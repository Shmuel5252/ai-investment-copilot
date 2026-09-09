"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import type { MarketIntelligence } from "@/lib/market/fmp";
import type { PortfolioFit } from "@/lib/portfolio/portfolio-fit";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import {
  caseDetailPage as t,
  casesListPage,
  decisionTypeLabel,
  caseStatusLabel,
  evidenceStrengthLabel,
  common,
} from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

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
    <main
      dir="rtl"
      lang="he"
      className={`${sansBody.className} mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 text-journal-ink`}
    >
      <BackLink href="/cases" label={casesListPage.title} />

      <div className="flex flex-col gap-1 border-b border-journal-rule pb-6">
        <h1 className={`${serifHeader.className} text-2xl font-bold`}>{investmentCase.ticker}</h1>
        <p className="text-xs text-journal-muted">
          {caseStatusLabel[investmentCase.status] ?? investmentCase.status} · {common.createdOnLabel}{" "}
          <Num>{new Date(investmentCase.createdAt).toLocaleDateString("he-IL")}</Num>
        </p>
      </div>

      {/* Market Intelligence */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t.marketIntelligenceTitle}</h2>
        <button
          onClick={() => guard(() => fetchMarketData.mutateAsync({ caseId: id, forceRefresh: !!intelligence }), "fetchMarketData")}
          disabled={fetchMarketData.isPending}
          className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {fetchMarketData.isPending ? t.fetchingButton : intelligence ? t.refreshButton : t.fetchButton}
        </button>
        {fetchMarketData.isError && <p className="text-sm text-red-600">{fetchMarketData.error.message}</p>}
        {intelligence && (
          <div className="rounded border border-journal-rule bg-journal-surface p-4 text-sm">
            {/* Company name, price and % change: all-Latin content (a
                real company name plus real numbers), stays one plain
                right-aligned block like any other real-data line — no
                Hebrew label is mixed into it, so there's no bidi
                boundary to isolate. */}
            <p className="font-medium">
              {intelligence.companyName} — ${intelligence.price.toFixed(2)}{" "}
              <span className={intelligence.changePercentage >= 0 ? "text-green-700" : "text-red-700"}>
                ({intelligence.changePercentage >= 0 ? "+" : ""}
                {intelligence.changePercentage.toFixed(2)}%)
              </span>
            </p>
            {/* sector/industry are FMP's own category strings (real
                data, not UI copy) — left exactly as fetched, never
                translated, same principle as companyName/description. */}
            <p className="mt-1 text-xs text-journal-muted">
              {intelligence.sector ?? t.unknownSector} · {intelligence.industry ?? t.unknownIndustry} ·{" "}
              {t.marketCapLabel} <Num>${intelligence.marketCap.toLocaleString()}</Num> · {t.betaLabel}{" "}
              <Num>{intelligence.beta ?? t.naLabel}</Num> · {t.weekRangeLabel}{" "}
              <Num>{intelligence.fiftyTwoWeekRange ?? t.naLabel}</Num>
            </p>
            {/* P/E, P/B, P/S, Div yield: standard Latin finance
                abbreviations (kept English, like S&P 500/VIX elsewhere)
                each directly followed by their own number — left as one
                unwrapped run per <Num>'s usage rule, not isolated
                piecemeal. */}
            <p className="mt-1 text-xs text-journal-muted">
              {intelligence.valuationRatiosAvailable
                ? `P/E ${intelligence.peRatioTtm?.toFixed(2)} · P/B ${intelligence.priceToBookRatioTtm?.toFixed(2)} · P/S ${intelligence.priceToSalesRatioTtm?.toFixed(2)} · Div yield ${intelligence.dividendYieldTtm ?? "n/a"}`
                : t.valuationRatiosUnavailable}
            </p>
            {intelligence.description && (
              <p className="mt-2 text-xs text-journal-muted">{intelligence.description}</p>
            )}
            <p className="mt-2 text-xs text-journal-muted">
              {t.fetchedAtLabel} <Num>{new Date(intelligence.fetchedAt).toLocaleString("he-IL")}</Num>
            </p>
          </div>
        )}
      </section>

      {/* Portfolio Fit */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t.portfolioFitTitle}</h2>
        <div className="flex gap-2">
          <input
            value={sizeDollars}
            onChange={(e) => setSizeDollars(e.target.value)}
            placeholder={t.hypotheticalSizePlaceholder}
            className="rounded border border-journal-rule bg-journal-surface p-2 text-sm"
          />
          <button
            onClick={() => guard(() => computeFit.mutateAsync({ caseId: id, sizeDollars: parsedSize }), "computeFit")}
            disabled={!intelligence || computeFit.isPending}
            className="rounded border border-journal-rule px-3 py-2 text-sm disabled:opacity-50"
          >
            {computeFit.isPending ? t.computingButton : t.computeFitButton}
          </button>
        </div>
        {!intelligence && <p className="text-xs text-journal-muted">{t.fetchMarketDataFirst}</p>}
        {computeFit.isError && <p className="text-sm text-red-600">{computeFit.error.message}</p>}
        {computeFit.data && (
          <>
            <PortfolioFitView fit={computeFit.data} />
            <SectorIndustryExposureView fit={computeFit.data} />
          </>
        )}
      </section>

      {/* Personal Fit */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t.personalFitTitle}</h2>
        <button
          onClick={() => guard(() => generatePersonalFit.mutateAsync({ caseId: id }), "generatePersonalFit")}
          disabled={generatePersonalFit.isPending}
          className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {generatePersonalFit.isPending ? t.assessingButton : t.generatePersonalFitButton}
        </button>
        {generatePersonalFit.isError && (
          <p className="text-sm text-red-600">{generatePersonalFit.error.message}</p>
        )}
        {investmentCase.personalFitText && (
          <div className="rounded border border-journal-rule bg-journal-surface p-4 text-sm">
            <div className="flex items-start justify-between gap-2">
              {/* AI-generated narrative — content, not chrome. */}
              <p>{investmentCase.personalFitText}</p>
              {!evidenceRefs?.hasTraceableEvidence && (
                <span className="shrink-0 rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                  {evidenceStrengthLabel.insufficient_evidence}
                </span>
              )}
            </div>
            {evidenceRefs && evidenceRefs.hasTraceableEvidence && (
              <ul className="mt-2 flex flex-col gap-1 border-t border-journal-rule pt-2 text-xs text-journal-muted">
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

      {/* Research Completeness — a plain readout of what data categories
          this page already has or doesn't, computed from what's already
          loaded here (no new fetch, no new source). Not a judgment about
          whether synthesis is "good enough" — just an honest inventory,
          so a synthesis based on thin research isn't mistaken for one
          based on complete research. */}
      <section className="flex flex-col gap-2 rounded border border-journal-rule bg-journal-surface p-4">
        <h2 className="text-xs font-semibold tracking-wide text-journal-muted">
          {t.researchCompletenessTitle}
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          <CompletenessRow
            label={t.marketIntelligenceRow}
            done={!!intelligence}
            detail={
              intelligence ? (
                <>
                  {t.fetchedLabel} <Num>{new Date(intelligence.fetchedAt).toLocaleDateString("he-IL")}</Num>
                </>
              ) : (
                t.notFetchedRequired
              )
            }
          />
          <CompletenessRow
            label={t.personalFitRow}
            done={!!investmentCase.personalFitText}
            detail={investmentCase.personalFitText ? t.generatedLabel : t.notGeneratedWontReflect}
          />
          <CompletenessRow
            label={t.dnaOnFileRow}
            done={(dnaList.data?.length ?? 0) > 0}
            detail={
              <>
                <Num>{dnaList.data?.length ?? 0}</Num> ({t.informsPersonalFitNotSynthesis})
              </>
            }
          />
          <CompletenessRow
            label={t.strategyOnFileRow}
            done={(strategyList.data?.principles.length ?? 0) > 0}
            detail={
              <>
                <Num>{strategyList.data?.principles.length ?? 0}</Num> ({t.informsPersonalFitNotSynthesis})
              </>
            }
          />
        </ul>
      </section>

      {/* Case Synthesis */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t.caseSynthesisTitle}</h2>
        <button
          onClick={() => guard(() => generateSynthesis.mutateAsync({ caseId: id, sizeDollars: parsedSize }), "generateSynthesis")}
          disabled={!intelligence || generateSynthesis.isPending}
          className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {generateSynthesis.isPending ? t.synthesizingButton : t.generateSynthesisButton}
        </button>
        {!intelligence && <p className="text-xs text-journal-muted">{t.fetchMarketDataFirst}</p>}
        {generateSynthesis.isError && <p className="text-sm text-red-600">{generateSynthesis.error.message}</p>}

        {investmentCase.synthesisText && (
          <div className="flex flex-col gap-3 rounded border border-journal-rule bg-journal-surface p-4 text-sm">
            {/* Everything below is AI-generated synthesis — content, not
                chrome; only the TextBlock labels are translated. */}
            <p className="font-medium">{investmentCase.synthesisText}</p>
            <TextBlock label={t.bullCase} text={investmentCase.bullCaseText} />
            <TextBlock label={t.bearCase} text={investmentCase.bearCaseText} />
            <TextBlock label={t.catalysts} text={investmentCase.catalystsText} />
            <TextBlock label={t.invalidationConditions} text={investmentCase.invalidationConditionsText} />
            <TextBlock label={t.portfolioFitNarrative} text={investmentCase.portfolioFitText} />
            <TextBlock label={t.marketBlindspot} text={investmentCase.marketBlindspotText} />
            <TextBlock label={t.devilsAdvocate} text={investmentCase.devilsAdvocateText} />
          </div>
        )}
      </section>

      {/* Record Decision */}
      <section className="flex flex-col gap-3 border-t border-journal-rule pt-6">
        <h2 className="text-sm font-semibold">{t.recordDecisionTitle}</h2>

        {existingDecision.data ? (
          <p className="text-sm">
            {t.decisionAlreadyRecordedPrefix}{" "}
            <Link href={`/decisions/${existingDecision.data.id}`} className="text-journal-accent underline">
              {t.viewDecisionSnapshot}
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-xs text-journal-muted">{t.freezeDescription}</p>
            <select
              value={decisionType}
              onChange={(e) => setDecisionType(e.target.value as (typeof DECISION_TYPES)[number])}
              className="w-fit rounded border border-journal-rule bg-journal-surface p-2 text-sm"
            >
              {DECISION_TYPES.map((dt) => (
                <option key={dt} value={dt}>
                  {decisionTypeLabel[dt] ?? dt}
                </option>
              ))}
            </select>
            <input
              value={sizeDollars}
              onChange={(e) => setSizeDollars(e.target.value)}
              placeholder={t.sizePlaceholder}
              className="rounded border border-journal-rule bg-journal-surface p-2 text-sm"
            />
            <textarea
              value={reasoningText}
              onChange={(e) => setReasoningText(e.target.value)}
              placeholder={t.reasoningPlaceholder}
              className="min-h-24 rounded border border-journal-rule bg-journal-surface p-2 text-sm"
            />
            <textarea
              value={risksConsideredText}
              onChange={(e) => setRisksConsideredText(e.target.value)}
              placeholder={t.risksPlaceholder}
              className="min-h-16 rounded border border-journal-rule bg-journal-surface p-2 text-sm"
            />
            <textarea
              value={exitConditionsText}
              onChange={(e) => setExitConditionsText(e.target.value)}
              placeholder={t.exitConditionsPlaceholder}
              className="min-h-16 rounded border border-journal-rule bg-journal-surface p-2 text-sm"
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
              className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {recordDecision.isPending
                ? t.recordingButton
                : `${t.recordPrefix} ${decisionTypeLabel[decisionType] ?? decisionType} ${t.recordSuffix}`}
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

function CompletenessRow({
  label,
  done,
  detail,
}: {
  label: string;
  done: boolean;
  detail: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      <span className={done ? "text-green-700" : "text-journal-muted"}>{done ? "✓" : "○"}</span>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-journal-muted">— {detail}</span>
    </li>
  );
}

function TextBlock({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-journal-muted">{label}</p>
      <p className="mt-1 leading-relaxed text-journal-ink">{text}</p>
    </div>
  );
}

function PortfolioFitView({ fit }: { fit: PortfolioFit }) {
  return (
    <div className="rounded border border-journal-rule bg-journal-surface p-4 text-sm">
      <p>
        {t.totalPortfolioValueLabel}: <Num>${fit.totalPortfolioValueUsd.toFixed(2)}</Num>
        {fit.totalPortfolioValueApproximate ? ` ${t.approximateNote}` : ""}
      </p>
      <p>
        {t.existingExposureLabel}: <Num>{fit.existingHoldingQuantity}</Num> {t.sharesOfLabel}{" "}
        <Num>${fit.existingPositionValueUsd.toFixed(2)}</Num> ·{" "}
        <Num>{fit.existingWeightPercent.toFixed(1)}%</Num> {t.ofPortfolioLabel}
      </p>
      {fit.projectedWeightPercent !== null && (
        <p>
          {t.projectedLabel}: <Num>${fit.projectedPositionValueUsd?.toFixed(2)}</Num> ·{" "}
          <Num>{fit.projectedWeightPercent.toFixed(1)}%</Num> {t.ofPortfolioLabel}
        </p>
      )}
      <p className="text-xs text-journal-muted">
        <Num>{fit.holdingsCount}</Num> {t.currentHoldingsLabel}
        {fit.largestCurrentPositionTicker ? (
          <>
            {" "}
            · {t.largestLabel}: {fit.largestCurrentPositionTicker} (
            <Num>{fit.largestCurrentPositionWeightPercent?.toFixed(1)}%</Num>)
          </>
        ) : (
          ""
        )}
      </p>
      {/* Warnings are generated by computePortfolioFit() itself
          (src/lib/portfolio/portfolio-fit.ts) — a protected, unit-tested
          calculation module (CLAUDE.md: computePositions/
          computePortfolioFit are never reimplemented or edited casually
          elsewhere). Left in English exactly as returned, not translated
          here, same boundary as AI-generated or user-authored text. */}
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

// Sector/Industry Exposure — deliberately a separate, visually-distinct
// card from PortfolioFitView above, not nested inline in it (Product
// decision). Cash always shown first, on its own line — never inside
// the sector/industry lists themselves (docs/backlog.md, Sector +
// Industry Exposure: cash is never a classification bucket). Current is
// always rendered; projected only when the hypothetical-size mutation
// actually returned it (same null-means-no-hypothetical-size pattern
// PortfolioFitView already follows for projectedWeightPercent above) —
// and when it is, current and projected render side by side, neither
// replacing the other.
function SectorIndustryExposureView({ fit }: { fit: PortfolioFit }) {
  return (
    <div className="rounded border border-journal-rule bg-journal-surface p-4 text-sm">
      <p>
        {t.cashLabel}: <Num>${fit.cashValueUsd.toFixed(2)}</Num> (
        <Num>{fit.cashWeightPercent.toFixed(1)}%</Num> {t.ofPortfolioLabel})
      </p>

      <ExposureBreakdown title={`${t.sectorExposureTitle} (${t.currentLabel})`} entries={fit.sectorExposure} labelOf={(e) => e.sector} />
      {fit.projectedSectorExposure !== null && (
        <ExposureBreakdown
          title={`${t.sectorExposureTitle} (${t.projectedLabel})`}
          entries={fit.projectedSectorExposure}
          labelOf={(e) => e.sector}
        />
      )}

      <ExposureBreakdown title={`${t.industryExposureTitle} (${t.currentLabel})`} entries={fit.industryExposure} labelOf={(e) => e.industry} />
      {fit.projectedIndustryExposure !== null && (
        <ExposureBreakdown
          title={`${t.industryExposureTitle} (${t.projectedLabel})`}
          entries={fit.projectedIndustryExposure}
          labelOf={(e) => e.industry}
        />
      )}
    </div>
  );
}

// Sorted by weightPercent descending — the Map-derived arrays computePortfolioFit()
// returns have no meaningful order of their own (insertion order into an
// internal Map, an implementation detail), so an explicit sort here is
// required, not cosmetic.
function ExposureBreakdown<E extends { weightPercent: number }>({
  title,
  entries,
  labelOf,
}: {
  title: string;
  entries: E[];
  labelOf: (entry: E) => string | null;
}) {
  const sorted = [...entries].sort((a, b) => b.weightPercent - a.weightPercent);
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold tracking-wide text-journal-muted">{title}</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-xs">
        {sorted.map((entry, i) => {
          const label = labelOf(entry);
          return (
            <li key={i}>
              {/* Every numeric/percent value in RTL uses <Num>, no
                  exception — even when the label itself is Latin
                  (approved contract, docs/backlog.md). */}
              {label === null ? t.unclassifiedLabel : label}:{" "}
              <Num>{entry.weightPercent.toFixed(1)}%</Num>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
