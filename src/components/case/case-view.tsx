"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { PageShell, PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { PriorRecordBriefView } from "@/components/prior-record-brief";
import { RegionBody } from "@/components/home/region";
import type { MarketIntelligence } from "@/lib/market/fmp";
import { caseDetailPage as t, casesListPage, caseStatusLabel, priorRecord as tPrior } from "@/lib/i18n/strings";
import { day } from "./parts";
import { ThoughtRegion, MarketRegion, ReadingRegion } from "./research-regions";
import { PortfolioFitRegion, PersonalFitRegion } from "./fit-regions";
import { ReadinessRegion, DecisionForm, DecidedNotice, type DecisionFormState } from "./decision-regions";
import { deriveReadiness, type InventoryKey } from "./derive-readiness";
import type { CaseData, CaseViewActions, CaseViewData, PersonalFitEvidenceRefs } from "./types";

// The Case / research file (Frontend V1, unit 3). Presentational: the page
// runs the existing queries and mutations, /styleguide renders the same view
// on synthetic data. Regions:
//   A header · B original thought · C market picture · G AI reading
//   side rail: D Portfolio Fit · E Personal Fit · F prior record
//   full width: H before recording · I recording
// Mobile reads them in that order. Nothing here computes, ranks or scores.

const EMPTY_FORM: DecisionFormState = {
  decisionType: "BUY",
  sizeInput: "",
  reasoningText: "",
  risksConsideredText: "",
  exitConditionsText: "",
  reviewHorizon: "",
  reviewByDate: "",
};

export function CaseView({ data, actions, initialForm }: { data: CaseViewData; actions: CaseViewActions; initialForm?: Partial<DecisionFormState> }) {
  const [form, setFormState] = useState<DecisionFormState>({ ...EMPTY_FORM, ...initialForm });
  const setForm = (patch: Partial<DecisionFormState>) => setFormState((f) => ({ ...f, ...patch }));

  const q = data.investmentCase;
  if (q.isError) {
    return (
      <PageShell width="wide">
        <ErrorState message={q.error?.message ?? null} onRetry={q.refetch ? () => void q.refetch!() : undefined} />
      </PageShell>
    );
  }
  if (q.isLoading || q.data === undefined) {
    return (
      <PageShell width="wide">
        <Skeleton lines={6} />
      </PageShell>
    );
  }
  if (q.data === null) {
    return (
      <PageShell width="wide">
        <EmptyState title={t.caseNotFound} action={<ButtonLink href="/cases" size="sm">{casesListPage.title}</ButtonLink>}>
          {t.caseNotFoundHint}
        </EmptyState>
      </PageShell>
    );
  }

  return <CaseFile caseData={q.data} data={data} actions={actions} form={form} setForm={setForm} />;
}

function CaseFile({
  caseData,
  data,
  actions,
  form,
  setForm,
}: {
  caseData: CaseData;
  data: CaseViewData;
  actions: CaseViewActions;
  form: DecisionFormState;
  setForm: (patch: Partial<DecisionFormState>) => void;
}) {
  const intelligence = caseData.marketIntelligenceJson as MarketIntelligence | null;
  const hasMarket = intelligence !== null;
  const decision = data.existingDecision.data ?? null;
  // A decided case is a closed file: the frozen copy lives in the snapshot, so
  // nothing here offers to refresh, recompute or regenerate it.
  const readOnly = decision !== null || caseData.status !== "researching";
  const size = form.sizeInput.trim() === "" ? undefined : Number(form.sizeInput);

  const readiness = deriveReadiness({
    status: caseData.status,
    hasApprovedStrategy: data.strategy.data?.hasApprovedVersion,
    reasoningText: form.reasoningText,
    reviewHorizon: form.reviewHorizon,
    reviewByDate: form.reviewByDate,
    marketFetched: hasMarket,
    fitComputedThisVisit: data.fit !== undefined,
    personalFitGenerated: Boolean(caseData.personalFitText),
    readingGenerated: Boolean(caseData.synthesisText),
  });

  const inventoryAction = (key: InventoryKey) => {
    const run = {
      market: () => actions.fetchMarket.run(),
      portfolioFit: () => actions.computeFit.run(size),
      personalFit: () => actions.personalFit.run(),
      reading: () => actions.reading.run(size),
    }[key];
    const pending = { market: actions.fetchMarket, portfolioFit: actions.computeFit, personalFit: actions.personalFit, reading: actions.reading }[key].pending;
    const label = { market: t.fetchButton, portfolioFit: t.computeFitButton, personalFit: t.generatePersonalFit, reading: t.generateReading }[key];
    return (
      <Button size="sm" variant="quiet" onClick={run} disabled={key !== "market" && !hasMarket} loading={pending}>
        {label}
      </Button>
    );
  };

  const header = (
    <PageHeader
      back={{ href: "/cases", label: casesListPage.title }}
      title={<Num>{caseData.ticker}</Num>}
      meta={
        <>
          <Badge tone={caseData.status === "researching" ? "info" : "neutral"}>{caseStatusLabel[caseData.status] ?? caseData.status}</Badge> · {t.openedPrefix}{" "}
          <Num>{day(caseData.createdAt)}</Num> · {t.updatedPrefix} <Num>{day(caseData.updatedAt)}</Num>
        </>
      }
      description={
        intelligence ? (
          <bdi>
            {intelligence.companyName}
            {intelligence.sector && ` · ${intelligence.sector}`}
            {intelligence.industry && ` · ${intelligence.industry}`}
          </bdi>
        ) : undefined
      }
      actions={
        decision ? (
          <ButtonLink href={`/decisions/${decision.id}`} variant="primary">
            {t.openDecision}
          </ButtonLink>
        ) : caseData.status === "researching" ? (
          <ButtonLink href="#record" variant="primary">
            {t.goToRecord}
          </ButtonLink>
        ) : undefined
      }
    />
  );

  const refs = caseData.personalFitEvidenceRefs as PersonalFitEvidenceRefs | null;

  return (
    <PageShell width="wide">
      {header}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-10">
          <Section id="thought" title={t.thoughtTitle}>
            <ThoughtRegion caseData={caseData} ideas={data.ideas} origin={data.origin} />
          </Section>
          <Section id="market" title={t.marketTitle}>
            <MarketRegion intelligence={intelligence} fetch={actions.fetchMarket} readOnly={readOnly} />
          </Section>
          <Section id="reading" title={t.readingTitle}>
            <ReadingRegion caseData={caseData} hasMarket={hasMarket} generate={actions.reading} sizeDollars={size} readOnly={readOnly} />
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-10">
          <Section id="portfolio-fit" title={t.portfolioFitTitle}>
            <PortfolioFitRegion
              fit={data.fit}
              hasMarket={hasMarket}
              compute={actions.computeFit}
              sizeInput={form.sizeInput}
              onSizeInput={(v) => setForm({ sizeInput: v })}
              readOnly={readOnly}
            />
          </Section>
          <Section id="personal-fit" title={t.personalFitTitle}>
            <RegionBody q={data.dna} lines={3}>
              {(dna) => (
                <PersonalFitRegion
                  text={caseData.personalFitText}
                  refs={refs}
                  dna={dna}
                  strategy={data.strategy.data?.principles ?? []}
                  hasMarket={hasMarket}
                  generate={actions.personalFit}
                  readOnly={readOnly}
                />
              )}
            </RegionBody>
          </Section>
          <Section id="prior-record" title={tPrior.title}>
            <RegionBody q={data.priorRecord} lines={4}>
              {(brief) => <PriorRecordBriefView brief={brief} />}
            </RegionBody>
          </Section>
        </div>
      </div>

      {!readOnly && (
        <Section id="before-recording" title={t.readinessTitle}>
          <ReadinessRegion readiness={readiness} inventoryAction={inventoryAction} />
        </Section>
      )}

      <Section id="record" title={t.recordTitle}>
        {data.existingDecision.isLoading ? (
          <Skeleton lines={3} />
        ) : decision ? (
          <DecidedNotice decision={decision} />
        ) : caseData.status !== "researching" ? (
          <p className="text-sm text-ink-2">{t.notResearching}</p>
        ) : (
          <DecisionForm form={form} setForm={setForm} formComplete={readiness.formComplete} record={actions.record} />
        )}
      </Section>
    </PageShell>
  );
}
