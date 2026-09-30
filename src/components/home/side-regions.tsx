import Link from "next/link";
import { Num } from "@/components/num";
import { List, ListRow } from "@/components/ui/list";
import { Card } from "@/components/ui/card";
import { Badge, EvidenceTierBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { KeyValues } from "@/components/ui/table";
import { EmptyState, HelpText } from "@/components/ui/states";
import { decisionTypeLabel, caseStatusLabel, openConditions as oc, homePage as t } from "@/lib/i18n/strings";
import { day, type OpenCondition, type CaseRow, type IdeaRow, type ReachData, type CoverageData, type NextActionRow } from "./types";

// E, F, G — the secondary column. Everything here is either the investor's
// own words (conditions, ideas) or a count the backend already derived
// (research status, evidence reach, journal coverage).

// ---------------------------------------------------------------- E
function ConditionList({ conditions }: { conditions: OpenCondition[] }) {
  return (
    <List label={t.conditionsTitle}>
      {conditions.map((c) => (
        <ListRow key={c.predictionId}>
          <p className="leading-relaxed text-ink">{c.claimText}</p>
          <p className="mt-1 text-xs text-muted">
            {oc.fromDecisionPrefix} {decisionTypeLabel[c.decisionType] ?? c.decisionType} <Num>{c.ticker}</Num> <Num>{day(c.decisionDate)}</Num>
            {c.checkableByDate && (
              <>
                {" · "}
                {oc.checkableByPrefix} <Num>{day(c.checkableByDate)}</Num>
              </>
            )}
            {" · "}
            <Link href={`/decisions/${c.decisionId}#predictions`} className="text-accent underline">
              {oc.openDecision}
            </Link>
          </p>
        </ListRow>
      ))}
    </List>
  );
}

// The conditions are the investor's own sentences and run long: on narrow
// screens they start collapsed behind a disclosure, on wide ones they show.
export function ConditionsView({ conditions }: { conditions: OpenCondition[] }) {
  if (conditions.length === 0) return <EmptyState title={t.conditionsEmpty} />;
  return (
    <>
      <div className="hidden md:block">
        <ConditionList conditions={conditions} />
      </div>
      <details className="group md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border border-rule bg-surface px-4 py-3 text-sm font-medium text-ink hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
          <span>
            {t.conditionsShow} (<Num>{conditions.length}</Num>)
          </span>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-muted transition-transform group-open:rotate-180">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="mt-2">
          <ConditionList conditions={conditions} />
        </div>
      </details>
    </>
  );
}

// ---------------------------------------------------------------- F
// "Stalled" is read from the CONTINUE_STALLED_CASE next action the backend
// derived for that case — the 14-day rule is never recomputed here.
export function ResearchView({ cases, ideas, actions }: { cases: CaseRow[]; ideas: IdeaRow[]; actions: NextActionRow[] }) {
  const researching = cases.filter((c) => c.status === "researching");
  const stalled = new Set(actions.filter((a) => a.kind === "CONTINUE_STALLED_CASE" && a.caseId).map((a) => a.caseId!));
  const waiting = ideas.filter((i) => i.promotedToCaseId === null);
  if (researching.length === 0 && waiting.length === 0) {
    return (
      <EmptyState
        title={t.researchEmpty}
        action={
          <ButtonLink href="/ideas" size="sm" variant="primary">
            {t.newIdea}
          </ButtonLink>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {researching.length > 0 && (
        <List label={t.researchTitle}>
          {researching.map((c) => (
            <ListRow
              key={c.id}
              actions={
                <ButtonLink href={`/cases/${c.id}`} size="sm" variant="quiet">
                  {t.openCase}
                </ButtonLink>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">
                  <Num>{c.ticker}</Num>
                </span>
                <span className="text-xs text-muted">
                  {caseStatusLabel[c.status] ?? c.status} · <Num>{day(c.createdAt)}</Num>
                </span>
                {stalled.has(c.id) && <Badge tone="caution">{t.stalled}</Badge>}
              </div>
            </ListRow>
          ))}
        </List>
      )}
      {waiting.length > 0 && (
        <p className="text-sm text-ink-2">
          {t.ideasWaitingPrefix} <Num>{waiting.length}</Num>
          {" · "}
          {waiting.slice(0, 5).map((i, n) => (
            <span key={i.id}>
              {n > 0 && ", "}
              <Num>{i.ticker}</Num>
            </span>
          ))}
          {waiting.length > 5 && " …"}{" "}
          <Link href="/ideas" className="text-accent underline">
            {t.openIdeas}
          </Link>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- G
function DomainLine({ claims, visibleToAi, insufficient }: { claims: number; visibleToAi: number; insufficient: number }) {
  if (claims === 0) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-col items-start gap-1">
      <span>
        <Num>{claims}</Num> {t.claimsUnit}
        {visibleToAi === 0 ? (
          <> · {t.allBelowThreshold}</>
        ) : (
          <>
            {" · "}
            <Num>{visibleToAi}</Num> {t.aboveThresholdMiddle} <Num>{insufficient}</Num> {t.belowThresholdSuffix}
          </>
        )}
      </span>
      {visibleToAi === 0 && <EvidenceTierBadge tier="insufficient_evidence" />}
    </span>
  );
}

export function MemoryView({ reach, coverage }: { reach: ReachData; coverage: CoverageData | undefined }) {
  const { dna, strategy, statements } = reach.summary;
  if (dna.claims === 0 && strategy.claims === 0) {
    return (
      <EmptyState
        title={t.memoryEmpty}
        action={
          <ButtonLink href="/interview" size="sm" variant="secondary">
            {t.openInterview}
          </ButtonLink>
        }
      />
    );
  }
  return (
    <Card padding="md">
      <KeyValues
        items={[
          { label: t.dnaLabel, value: <DomainLine claims={dna.claims} visibleToAi={dna.visibleToAi} insufficient={dna.insufficient} /> },
          { label: t.strategyLabel, value: <DomainLine claims={strategy.claims} visibleToAi={strategy.visibleToAi} insufficient={strategy.insufficient} /> },
          {
            label: t.statementsLabel,
            value: (
              <span className="flex flex-col">
                <span>
                  <Num>{statements.total}</Num>
                </span>
                {dna.uncitedStatements > 0 && (
                  <span className="text-xs text-muted">
                    <Num>{dna.uncitedStatements}</Num> {t.uncitedMiddle}DNA
                  </span>
                )}
                {strategy.uncitedStatements > 0 && (
                  <span className="text-xs text-muted">
                    <Num>{strategy.uncitedStatements}</Num> {t.uncitedMiddle}Strategy
                  </span>
                )}
              </span>
            ),
          },
          ...(coverage
            ? [
                {
                  label: t.journalLabel,
                  value: (
                    <>
                      <Num>{coverage.covered}</Num> {t.coverageMiddle} <Num>{coverage.total}</Num> {t.coverageSuffix}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-3">
        <ButtonLink href="/dna" size="sm" variant="quiet">
          {t.openDna}
        </ButtonLink>
        <ButtonLink href="/strategy" size="sm" variant="quiet">
          {t.openStrategy}
        </ButtonLink>
        <ButtonLink href="/journal" size="sm" variant="quiet">
          {t.openJournal}
        </ButtonLink>
      </div>
      <HelpText className="mt-3">{t.memoryFootnote}</HelpText>
    </Card>
  );
}
