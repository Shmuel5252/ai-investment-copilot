import Link from "next/link";
import { Num } from "@/components/num";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KeyValues } from "@/components/ui/table";
import { EmptyState, HelpText, Skeleton } from "@/components/ui/states";
import type { MarketIntelligence } from "@/lib/market/fmp";
import { caseDetailPage as t, decisionTypeLabel } from "@/lib/i18n/strings";
import { RegionBody } from "@/components/home/region";
import type { Loadable } from "@/components/home/types";
import { ActionError, Provenance, Quote, dateTime, day, usd } from "./parts";
import type { CaseAction, CaseData, IdeaData, OriginData } from "./types";

// B, C and G: the idea in the investor's words, the fetched market facts,
// and the one AI reading of the case.

// B — never synthesized: the idea note the case was promoted from, the
// condition it was opened from, or an honest empty state.
export function ThoughtRegion({ caseData, ideas, origin }: { caseData: CaseData; ideas: Loadable<IdeaData[]>; origin: Loadable<OriginData | null> }) {
  const idea = caseData.ideaId ? ideas.data?.find((i) => i.id === caseData.ideaId) : undefined;
  const hasOrigin = origin.data != null;

  if (caseData.ideaId && ideas.data === undefined) return <RegionBody q={ideas} lines={2}>{() => null}</RegionBody>;
  if (!caseData.ideaId && origin.isLoading) return <Skeleton lines={2} />;

  if (!caseData.ideaId && !hasOrigin) {
    return <EmptyState title={t.thoughtEmptyTitle}>{t.thoughtEmpty}</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-4">
      {caseData.ideaId &&
        (idea ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {t.thoughtFromIdeaPrefix}
              <Num>{day(idea.createdAt)}</Num>
            </p>
            <Quote>{idea.noteText}</Quote>
          </div>
        ) : (
          <HelpText>{t.thoughtIdeaMissing}</HelpText>
        ))}
      {origin.data && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            {t.thoughtFromCondition} · {t.originFromDecisionPrefix} {decisionTypeLabel[origin.data.decisionType] ?? origin.data.decisionType} <Num>{origin.data.ticker}</Num>{" "}
            <Num>{day(origin.data.decisionDate)}</Num>
          </p>
          <Quote>{origin.data.claimText}</Quote>
          {origin.data.resolutionNote && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted">{t.originResolutionNotePrefix}</p>
              <Quote>{origin.data.resolutionNote}</Quote>
            </div>
          )}
          <Link href={`/decisions/${origin.data.decisionId}`} className="w-fit text-sm text-accent underline">
            {t.originOpenDecision}
          </Link>
        </div>
      )}
      <HelpText>{t.thoughtHint}</HelpText>
    </div>
  );
}

// C — the FMP snapshot exactly as stored on the case, with the time of the
// data itself (fetchedAt), never "now". Refresh keeps the existing semantics:
// forceRefresh once data exists; the shared 15-minute cache may still answer.
export function MarketRegion({ intelligence, fetch, readOnly }: { intelligence: MarketIntelligence | null; fetch: CaseAction; readOnly: boolean }) {
  const button = !readOnly && (
    <Button size="sm" variant="secondary" onClick={() => fetch.run()} loading={fetch.pending} loadingLabel={t.fetchingButton}>
      {intelligence ? t.refreshButton : t.fetchButton}
    </Button>
  );

  if (!intelligence) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState title={t.marketEmptyTitle} action={button || undefined}>
          {t.marketEmpty}
        </EmptyState>
        <ActionError message={fetch.error} />
      </div>
    );
  }

  const m = intelligence;
  const ratio = (n: number | null) => (n === null ? t.naLabel : <Num>{n.toFixed(2)}</Num>);
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex flex-col gap-4">
          <KeyValues
            items={[
              { label: t.priceLabel, value: <Num>{usd(m.price)}</Num> },
              { label: t.dayChangeLabel, value: <Num>{`${m.changePercentage >= 0 ? "+" : ""}${m.changePercentage.toFixed(2)}%`}</Num> },
              { label: t.marketCapLabel, value: <Num>{"$" + m.marketCap.toLocaleString("en-US")}</Num> },
              { label: t.betaLabel, value: m.beta === null ? t.naLabel : <Num>{m.beta}</Num> },
              { label: t.weekRangeLabel, value: m.fiftyTwoWeekRange ? <Num>{m.fiftyTwoWeekRange}</Num> : t.naLabel },
              { label: t.sectorLabel, value: m.sector ? <bdi>{m.sector}</bdi> : t.unknownSector },
              { label: t.industryLabel, value: m.industry ? <bdi>{m.industry}</bdi> : t.unknownIndustry },
              {
                label: t.valuationLabel,
                value: m.valuationRatiosAvailable ? (
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>P/E {ratio(m.peRatioTtm)}</span>
                    <span>P/B {ratio(m.priceToBookRatioTtm)}</span>
                    <span>P/S {ratio(m.priceToSalesRatioTtm)}</span>
                    <span>Div yield {m.dividendYieldTtm === null ? t.naLabel : <Num>{m.dividendYieldTtm}</Num>}</span>
                  </span>
                ) : (
                  <span className="text-muted">{t.valuationRatiosUnavailable}</span>
                ),
              },
            ]}
          />
          {m.description && (
            <div className="flex flex-col gap-1 border-t border-rule pt-3">
              <p className="text-xs text-muted">{t.descriptionLabel}</p>
              {/* FMP's own English text, as fetched: left-to-right so its punctuation stays put */}
              <p dir="ltr" lang="en" className="text-start text-sm leading-relaxed text-ink-2">
                {m.description}
              </p>
            </div>
          )}
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Provenance>
          {t.marketProvenancePrefix} <Num>{dateTime(m.fetchedAt)}</Num>. {t.marketCacheNote}
        </Provenance>
        {button}
      </div>
      <ActionError message={fetch.error} />
    </div>
  );
}

// G — the eight stored synthesis fields read as ONE analysis, in the approved
// order, under a single statement of what the AI did and did not see.
const READING: { key: keyof CaseData; label: string }[] = [
  { key: "bullCaseText", label: t.bullCase },
  { key: "catalystsText", label: t.catalysts },
  { key: "bearCaseText", label: t.bearCase },
  { key: "devilsAdvocateText", label: t.devilsAdvocate },
  { key: "invalidationConditionsText", label: t.invalidationConditions },
  { key: "marketBlindspotText", label: t.marketBlindspot },
  { key: "portfolioFitText", label: t.portfolioFitNarrative },
];

export function ReadingRegion({
  caseData,
  hasMarket,
  generate,
  sizeDollars,
  readOnly,
}: {
  caseData: CaseData;
  hasMarket: boolean;
  generate: CaseAction<[sizeDollars: number | undefined]>;
  sizeDollars: number | undefined;
  readOnly: boolean;
}) {
  const exists = Boolean(caseData.synthesisText);
  const button = !readOnly && (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => generate.run(sizeDollars)}
      disabled={!hasMarket}
      loading={generate.pending}
      loadingLabel={t.generatingReading}
    >
      {exists ? t.regenerateReading : t.generateReading}
    </Button>
  );

  if (!exists) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState title={t.readingEmptyTitle} action={button || undefined}>
          {t.readingEmpty}
          {!hasMarket && !readOnly && <> {t.readingNeedsMarket}</>}
        </EmptyState>
        <ActionError message={generate.error} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Provenance>{t.readingProvenance}</Provenance>
      <Card>
        <article className="flex flex-col gap-4 text-sm leading-relaxed">
          <div>
            <h3 className="text-xs font-semibold text-muted">{t.summaryLabel}</h3>
            <p className="mt-1 font-medium text-ink">{caseData.synthesisText}</p>
          </div>
          {READING.map(({ key, label }) => {
            const text = caseData[key] as string | null;
            if (!text) return null;
            return (
              <div key={key} className="border-t border-rule pt-3">
                <h3 className="text-xs font-semibold text-muted">{label}</h3>
                <p className="mt-1 text-ink-2">{text}</p>
              </div>
            );
          })}
        </article>
      </Card>
      {button && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <HelpText>{t.regenerateWarning}</HelpText>
          {button}
        </div>
      )}
      <ActionError message={generate.error} />
    </div>
  );
}
