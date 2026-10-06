import { Num, shares } from "@/components/num";
import { Section } from "@/components/ui/section";
import { List, ListRow } from "@/components/ui/list";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { decisionAttention as da, decisionTypeLabel, homePage as t, nextActions as na } from "@/lib/i18n/strings";
import { day, type ExecutionFact, type MonitoringItem, type NextActionRow, type AttentionData } from "./types";

// B — decisions that need attention. Rows come from the monitoring engine in
// its own order; each fact line is the engine's fact, never an interpretation.
// Next actions that name the same decision render here (joined upstream) and
// never again under "הצעד הבא".

const latestPersisted = (facts: ExecutionFact[]) => new Date(Math.max(...facts.map((f) => new Date(f.persistedAt).getTime())));
// Display truncation only: the newest fact (by when it entered the system,
// the same clock the monitoring engine uses) and a count of the rest. The
// facts themselves, their number and the attention reasons are untouched;
// the full list is on the decision page.
export function compactFacts<F extends { persistedAt: string | Date }>(facts: readonly F[]): { first: F | undefined; more: number } {
  const newest = [...facts].sort((a, b) => new Date(b.persistedAt).getTime() - new Date(a.persistedAt).getTime())[0];
  return { first: newest, more: Math.max(0, facts.length - 1) };
}

function Fact({ f }: { f: ExecutionFact }) {
  return (
    <>
      {da.txnType[f.transactionType] ?? f.transactionType}{" "}
      <Num>
        {shares(f.quantity)} @ {f.price !== null ? "$" + Number(f.price).toFixed(2) : "?"}
      </Num>{" "}
      (<Num>{day(f.transactionDate)}</Num>)
    </>
  );
}

function FactList({ facts }: { facts: ExecutionFact[] }) {
  const { first, more } = compactFacts(facts);
  if (!first) return null;
  return (
    <>
      <Fact f={first} />
      {more > 0 && (
        <>
          {" "}
          {t.moreFactsPrefix} <Num>{more}</Num>
        </>
      )}
    </>
  );
}

function AttentionRow({ item, joined }: { item: MonitoringItem; joined: NextActionRow[] }) {
  const href = `/decisions/${item.decisionId}`;
  const joinedHrefs = new Set(joined.map((a) => a.destination));
  const links = [
    { href, label: da.openDecision },
    { href: `${href}#later-context`, label: da.addContext },
    { href: `${href}#review`, label: da.runReview },
    ...(item.execution.after.length + item.execution.sameDay.length + item.execution.backfilledBefore.length > 0 ? [{ href: `${href}#execution`, label: da.markExecution }] : []),
  ].filter((l) => !joinedHrefs.has(l.href));

  return (
    <ListRow
      actionsBelow
      actions={
        <>
          {joined.map((a) => (
            <ButtonLink key={a.key} href={a.destination} size="sm" variant="secondary">
              {na.destination[a.kind]}
            </ButtonLink>
          ))}
          {links.map((l) => (
            <ButtonLink key={l.href} href={l.href} size="sm" variant="quiet">
              {l.label}
            </ButtonLink>
          ))}
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-ink">
            {decisionTypeLabel[item.decisionType] ?? item.decisionType} <Num>{item.ticker}</Num>
          </span>
          <span className="num text-xs text-muted">
            <Num>{day(item.decisionDate)}</Num>
          </span>
          {item.reasons.map((r) => (
            <Badge key={r} tone={r === "REVIEW_DUE" || r === "PREDICTION_DUE" ? "caution" : "info"}>
              {da.reason[r] ?? r}
            </Badge>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 text-ink-2">
          {item.reasons.includes("REVIEW_DUE") && item.horizon.reviewByDate && (
            <p>
              {da.reviewDueFact} <Num>{day(item.horizon.reviewByDate)}</Num>
            </p>
          )}
          {item.reasons.includes("PREDICTION_DUE") && (
            <p>
              <Num>{item.predictions.due.length}</Num> {da.predictionDueFact}
            </p>
          )}
          {item.reasons.includes("NEW_EXECUTION_AFTER_DECISION") && (
            <p>
              <Num>{item.newExecutionAfterDecision.length}</Num> {da.newExecutionFactMiddle}
              <Num>{item.ticker}</Num> {da.newExecutionFactSuffix}
              <Num>{day(latestPersisted(item.newExecutionAfterDecision))}</Num>: <FactList facts={item.newExecutionAfterDecision} />
            </p>
          )}
          {item.reasons.includes("HISTORY_BACKFILLED") && (
            <p>
              <Num>{item.backfilled.length}</Num> {da.backfilledFactMiddle}
              <Num>{item.ticker}</Num> {da.backfilledFactSuffix}
              <Num>{day(latestPersisted(item.backfilled))}</Num>: <FactList facts={item.backfilled} />. {da.backfilledNote}
            </p>
          )}
          {joined.map((a) => (
            <p key={a.key}>
              {a.kind === "RESOLVE_EXECUTION_CANDIDATES" && a.count !== undefined && (
                <>
                  <Num>{a.count}</Num>{" "}
                </>
              )}
              {t.joinedFact[a.kind] ?? a.kind}
            </p>
          ))}
        </div>
        <p className="text-xs text-muted">
          {item.execution.sameDay.length > 0 && (
            <>
              <Num>{item.execution.sameDay.length}</Num> {da.sameDayFact}
              {" · "}
            </>
          )}
          {item.execution.status === "history_before_decision" && (
            <>
              {da.executionUnavailablePrefix} {item.execution.historyThrough ? <Num>{day(item.execution.historyThrough)}</Num> : "—"}
              {" · "}
            </>
          )}
          {item.position.status === "ok" ? (
            item.position.held ? (
              <>
                {da.heldPrefix} <Num>{shares(item.position.quantity)} @ {item.position.costBasisPerShare !== null ? "$" + item.position.costBasisPerShare.toFixed(2) : "?"}</Num>
              </>
            ) : (
              da.flat
            )
          ) : (
            da.positionUnavailable
          )}
          {item.position.frozenHoldingQuantity !== null && (
            <>
              {" · "}
              {da.frozenHoldingPrefix} <Num>{shares(item.position.frozenHoldingQuantity)}</Num>
            </>
          )}
        </p>
      </div>
    </ListRow>
  );
}

export function AttentionView({ data, joined }: { data: AttentionData; joined: Map<string, NextActionRow[]> }) {
  if (data.attention.length === 0) {
    return (
      <EmptyState title={t.attentionEmpty}>
        {data.historyThrough ? (
          <>
            {t.historyThroughPrefix} <Num>{day(data.historyThrough)}</Num>.
          </>
        ) : (
          t.noHistory
        )}
      </EmptyState>
    );
  }
  return (
    <List label={t.attentionTitle}>
      {data.attention.map((item) => (
        <AttentionRow key={item.decisionId} item={item} joined={joined.get(item.decisionId) ?? []} />
      ))}
    </List>
  );
}

export function AttentionSection({ count, children }: { count?: number; children: React.ReactNode }) {
  return (
    <Section id="attention" title={t.attentionTitle} count={count} hint={t.attentionHint}>
      {children}
    </Section>
  );
}
