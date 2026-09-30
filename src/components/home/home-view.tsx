import { Num } from "@/components/num";
import { PageShell, PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { ButtonLink } from "@/components/ui/button";
import { homePage as t } from "@/lib/i18n/strings";
import { RegionBody } from "./region";
import { AttentionView } from "./attention-region";
import { StepsView } from "./steps-region";
import { MonitoringView } from "./monitoring-region";
import { ConditionsView, ResearchView, MemoryView } from "./side-regions";
import { joinNextActionsToAttention } from "./join-next-actions";
import {
  day,
  type Loadable,
  type AttentionData,
  type NextActionRow,
  type OpenCondition,
  type CaseRow,
  type IdeaRow,
  type ReachData,
  type HistoryData,
  type CoverageData,
} from "./types";

// Home — the investor's decision cockpit (Frontend V1, unit 2). Presentational
// only: src/app/page.tsx runs the queries, /styleguide renders the same view
// on synthetic data. Regions, top to bottom and then the secondary column:
//   A orientation · B attention · C next steps · D monitoring
//   E conditions · F open research · G investment memory
// Every region loads and fails on its own.
export interface HomeData {
  attention: Loadable<AttentionData>;
  nextActions: Loadable<NextActionRow[]>;
  conditions: Loadable<OpenCondition[]>;
  cases: Loadable<CaseRow[]>;
  ideas: Loadable<IdeaRow[]>;
  reach: Loadable<ReachData>;
  history: Loadable<HistoryData>;
  coverage: Loadable<CoverageData>;
}

function Orientation({ history, attention, remainingSteps, conditions }: { history: HistoryData | undefined; attention: AttentionData | undefined; remainingSteps: number | undefined; conditions: number | undefined }) {
  const parts: React.ReactNode[] = [];
  if (history) {
    parts.push(
      history.latestTransactionDate ? (
        <span key="h">
          {t.historyThroughPrefix} <Num>{day(history.latestTransactionDate)}</Num>
          {history.ageDays !== null && (
            <>
              {" · "}
              {history.ageDays === 0 ? (
                t.historyToday
              ) : (
                <>
                  {t.historyAgePrefix} <Num>{history.ageDays}</Num> {t.historyAgeSuffix}
                </>
              )}
            </>
          )}
        </span>
      ) : (
        <span key="h">{t.noHistory}</span>
      )
    );
  }
  if (attention) {
    parts.push(
      <span key="p">
        {t.portfolioStatusPrefix} {t.portfolioStatus[attention.portfolioStatus] ?? attention.portfolioStatus}
      </span>
    );
  }
  const counts: React.ReactNode[] = [];
  if (attention)
    counts.push(
      <span key="a">
        <Num>{attention.attention.length}</Num> {t.countAttention}
      </span>
    );
  if (remainingSteps !== undefined)
    counts.push(
      <span key="s">
        <Num>{remainingSteps}</Num> {t.countSteps}
      </span>
    );
  if (conditions !== undefined)
    counts.push(
      <span key="c">
        <Num>{conditions}</Num> {t.countConditions}
      </span>
    );
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      ))}
      {counts.length > 0 && (
        <span className="block">
          {counts.map((c, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {c}
            </span>
          ))}
        </span>
      )}
    </>
  );
}

export function HomeView({ data }: { data: HomeData }) {
  const attention = data.attention.data;
  const actions = data.nextActions.data;
  // The join needs both lists; until attention is known (or has failed),
  // "הצעד הבא" waits instead of briefly showing rows that will move.
  const attentionSettled = attention !== undefined || data.attention.isError;
  const joined = actions && attentionSettled ? joinNextActionsToAttention(attention?.attention.map((i) => i.decisionId) ?? [], actions) : undefined;

  const stepsQ: Loadable<NextActionRow[]> = {
    data: joined?.remaining,
    isLoading: data.nextActions.isLoading || !attentionSettled,
    isError: data.nextActions.isError,
    error: data.nextActions.error,
    refetch: data.nextActions.refetch,
  };

  return (
    <PageShell width="wide">
      <PageHeader
        title={t.title}
        meta={<Orientation history={data.history.data} attention={attention} remainingSteps={joined?.remaining.length} conditions={data.conditions.data?.length} />}
        actions={
          <ButtonLink href="/ideas" variant="primary">
            {t.newIdea}
          </ButtonLink>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-10">
          <Section id="attention" title={t.attentionTitle} count={attention?.attention.length} hint={t.attentionHint}>
            <RegionBody q={data.attention} lines={4}>
              {(a) => <AttentionView data={a} joined={joined?.byDecision ?? new Map()} />}
            </RegionBody>
          </Section>

          <Section id="next-steps" title={t.stepsTitle} count={joined?.remaining.length}>
            <RegionBody q={stepsQ}>{(remaining) => <StepsView remaining={remaining} />}</RegionBody>
          </Section>

          <Section id="monitoring" title={t.monitoringTitle} count={attention?.items.length} hint={t.monitoringHint}>
            <RegionBody q={data.attention} lines={4}>
              {(a) => <MonitoringView items={a.items} />}
            </RegionBody>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-10">
          <Section id="conditions" title={t.conditionsTitle} count={data.conditions.data?.length} hint={t.conditionsHint}>
            <RegionBody q={data.conditions}>{(c) => <ConditionsView conditions={c} />}</RegionBody>
          </Section>

          <Section id="research" title={t.researchTitle} hint={t.researchHint}>
            <RegionBody q={data.cases} lines={2}>
              {(cases) => (
                <RegionBody q={data.ideas} lines={1}>
                  {(ideas) => <ResearchView cases={cases} ideas={ideas} actions={actions ?? []} />}
                </RegionBody>
              )}
            </RegionBody>
          </Section>

          <Section id="memory" title={t.memoryTitle} hint={t.memoryHint}>
            <RegionBody q={data.reach} lines={4}>
              {(reach) => <MemoryView reach={reach} coverage={data.coverage.data} />}
            </RegionBody>
          </Section>
        </div>
      </div>
    </PageShell>
  );
}
