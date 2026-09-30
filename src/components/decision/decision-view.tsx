"use client";

import { PageShell } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { RegionBody } from "@/components/home/region";
import { decisionExecution, decisionPage as t, decisionsListPage } from "@/lib/i18n/strings";
import { DecisionHeader, ThenRecord } from "./record-regions";
import { TodayLine, LaterContextRegion, ExecutionRegion } from "./since-regions";
import { PredictionsRegion } from "./predictions-region";
import { ReviewRegion } from "./review-region";
import type { DecisionViewActions, DecisionViewData } from "./types";

// The Decision record + Review (Frontend V1, unit 4). Presentational: the
// page runs the existing queries and mutations, /styleguide renders the same
// view on synthetic data. The primary distinction is time, said in words:
//   אז    — what was known and written, frozen at recording
//   היום  — live monitoring facts, derived now, not part of the record
//   מאז   — what the investor added or resolved after recording
// then the predictions (a THEN claim beside a SINCE determination) and the
// retrospective Review. The two upper columns are a layout, not a meaning:
// every region names its own time, so the page reads the same stacked.
export function DecisionView({ data, actions }: { data: DecisionViewData; actions: DecisionViewActions }) {
  const q = data.record;
  if (q.isError) {
    return (
      <PageShell width="wide">
        <ErrorState title={t.notFoundTitle} message={q.error?.message ?? null} onRetry={q.refetch ? () => void q.refetch!() : undefined} />
      </PageShell>
    );
  }
  if (q.data === undefined) {
    return (
      <PageShell width="wide">
        <Skeleton lines={8} />
      </PageShell>
    );
  }

  const { decision, snapshot, predictions, marketContext } = q.data;

  if (!snapshot) {
    return (
      <PageShell width="wide">
        <DecisionHeader decision={decision} snapshot={null} setReviewDate={actions.setReviewDate} />
        <EmptyState
          title={t.noSnapshotTitle}
          action={
            <ButtonLink href="/decisions" size="sm">
              {decisionsListPage.title}
            </ButtonLink>
          }
        >
          {t.noSnapshotHint}
        </EmptyState>
      </PageShell>
    );
  }

  return (
    <PageShell width="wide">
      <DecisionHeader decision={decision} snapshot={snapshot} setReviewDate={actions.setReviewDate} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:gap-12">
        <Section id="then" title={t.thenTitle} hint={t.thenHint} className="min-w-0">
          <ThenRecord snapshot={snapshot} marketContext={marketContext} currentStrategyVersionId={data.currentStrategyVersionId.isError ? undefined : data.currentStrategyVersionId.data} />
        </Section>

        <div className="flex min-w-0 flex-col gap-10">
          <Section id="today" title={t.todayTitle} hint={t.todayHint}>
            <RegionBody q={data.today} lines={3}>
              {(today) => <TodayLine today={today} />}
            </RegionBody>
          </Section>

          <Section id="since" title={t.sinceTitle} hint={t.sinceHint}>
            <div className="flex flex-col gap-8">
              <div id="later-context" className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-ink">{t.laterContextTitle}</h3>
                <LaterContextRegion contexts={data.laterContexts} add={actions.addLaterContext} />
              </div>
              <div id="execution" className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-ink">{decisionExecution.title}</h3>
                <ExecutionRegion execution={data.execution} mark={actions.markExecution} />
              </div>
            </div>
          </Section>
        </div>
      </div>

      <Section id="predictions" title={t.predictionsTitle} count={predictions.length} hint={t.predictionsHint}>
        <PredictionsRegion predictions={predictions} conditionActions={actions.conditions} reconsiderationCases={data.reconsiderationCases} />
      </Section>

      <Section id="review" title={t.reviewTitle} count={data.reviews.data?.length} hint={t.reviewHint}>
        <RegionBody q={data.reviews} lines={4}>
          {(reviews) => (
            <RegionBody q={data.pendingPredictions} lines={2}>
              {(pending) => <ReviewRegion decisionType={decision.decisionType} reviews={reviews} pending={pending} run={actions.runReview} disagree={actions.disagree} />}
            </RegionBody>
          )}
        </RegionBody>
      </Section>
    </PageShell>
  );
}
