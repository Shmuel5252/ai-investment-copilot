import { Num } from "@/components/num";
import { List, ListRow } from "@/components/ui/list";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { nextActions as t, decisionTypeLabel, homePage as h } from "@/lib/i18n/strings";
import { day, type NextActionRow } from "./types";

// C — the next actions left after the join, in the catalogue order they
// arrived in. FACT -> REASON -> DESTINATION, word for word from the existing
// next-action copy; a row disappears when the backend stops deriving it.

function decisionLabel(a: NextActionRow) {
  if (!a.decision) return null;
  return (
    <>
      {decisionTypeLabel[a.decision.decisionType] ?? a.decision.decisionType} <Num>{a.decision.ticker}</Num> (<Num>{day(a.decision.decisionDate)}</Num>)
    </>
  );
}

export function stepFact(a: NextActionRow): React.ReactNode {
  switch (a.kind) {
    case "RESOLVE_EXECUTION_CANDIDATES":
      return (
        <>
          {t.fact.execPrefix}
          {decisionLabel(a)} {t.fact.execMiddle} <Num>{a.count}</Num> {t.fact.execSuffix}
        </>
      );
    case "REVIEW_UNREVIEWED_DECISION":
      return (
        <>
          {decisionLabel(a)} {t.fact.unreviewed}
        </>
      );
    case "SET_REVIEW_HORIZON":
      return (
        <>
          {decisionLabel(a)} {t.fact.noHorizon}
        </>
      );
    case "RESOLVE_OPEN_REENTRY_CONDITION":
      return (
        <>
          {t.fact.conditionPrefix}
          {decisionLabel(a)}
        </>
      );
    case "CONTINUE_STALLED_CASE":
      return (
        <>
          {t.fact.stalledCasePrefix} <Num>{a.ticker}</Num> {t.fact.stalledCaseSuffix}
        </>
      );
    case "ADD_EPISODE_RATIONALE":
      return (
        <>
          <Num>{a.count}</Num> {t.fact.rationale}
        </>
      );
    case "REGENERATE_WITH_UNUSED_EVIDENCE":
      return (
        <>
          <Num>{a.count}</Num> {a.domain === "dna" ? t.fact.unusedDna : t.fact.unusedStrategy}
        </>
      );
  }
}

export function StepsView({ remaining }: { remaining: NextActionRow[] }) {
  if (remaining.length === 0) return <EmptyState title={h.stepsEmpty} />;
  return (
    <List label={h.stepsTitle}>
      {remaining.map((a) => (
        <ListRow
          key={a.key}
          actions={
            <ButtonLink href={a.destination} size="sm" variant="secondary">
              {t.destination[a.kind]}
            </ButtonLink>
          }
        >
          <p className="text-ink" data-next-action={a.kind}>
            {stepFact(a)}
          </p>
          <p className="mt-0.5 text-xs text-muted">{t.reason[a.kind]}</p>
        </ListRow>
      ))}
    </List>
  );
}
