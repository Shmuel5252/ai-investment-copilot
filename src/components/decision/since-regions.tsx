"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { List, ListRow } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { Field, Textarea } from "@/components/ui/field";
import { Skeleton, ErrorState } from "@/components/ui/states";
import { Quote } from "@/components/ui/quote";
import { ExecutionView, type Candidate, type ExecutionData } from "@/components/execution-facts";
import type { Loadable } from "@/components/home/types";
import { addedByLabel, decisionPage as t } from "@/lib/i18n/strings";
import { ActionError, dateTime, day } from "./parts";
import type { DecisionAction, LaterContextRow, TodayData } from "./types";

// E — TODAY: a line of live monitoring facts (decisions.attention), never a
// price, a P&L or a judgment. Not part of the record.
export function TodayLine({ today }: { today: TodayData }) {
  const item = today.item;
  if (!item || item.state === "settled") {
    return (
      <p className="text-sm text-ink-2">
        {t.settled}
        {today.historyThrough && <HistoryThrough date={today.historyThrough} />}
      </p>
    );
  }
  const position =
    item.position.held === null ? (
      t.positionUnknown
    ) : item.position.held ? (
      <>
        {t.heldPrefix}{" "}
        <Num>
          {item.position.quantity} @ {item.position.costBasisPerShare !== null ? "$" + item.position.costBasisPerShare.toFixed(2) : "?"}
        </Num>
      </>
    ) : (
      t.flat
    );
  return (
    <ul className="flex flex-col gap-1.5 text-sm text-ink-2">
      <li>
        <Status tone={item.horizon.status === "due" ? "caution" : "neutral"}>
          {t.horizon[item.horizon.status] ?? item.horizon.status}
          {item.horizon.reviewByDate && (
            <>
              {" · "}
              <Num>{day(item.horizon.reviewByDate)}</Num>
            </>
          )}
        </Status>
      </li>
      {item.predictions.due.length > 0 && (
        <li>
          <Status tone="caution">
            <Num>{item.predictions.due.length}</Num> {t.predictionsDueSuffix}
          </Status>
        </li>
      )}
      {item.predictions.pending > 0 && (
        <li>
          <Status tone="neutral">
            <Num>{item.predictions.pending}</Num> {t.pendingSuffix}
          </Status>
        </li>
      )}
      <li>
        <Status tone="neutral">{position}</Status>
      </li>
      {today.historyThrough && (
        <li className="text-xs text-muted">
          {t.historyThroughPrefix} <Num>{day(today.historyThrough)}</Num>
        </li>
      )}
    </ul>
  );
}

function HistoryThrough({ date }: { date: string | Date }) {
  return (
    <span className="block text-xs text-muted">
      {t.historyThroughPrefix} <Num>{day(date)}</Num>
    </span>
  );
}

// F — SINCE: what the investor added after recording. Later context is
// appended next to the record, never into it; execution facts are the
// investor's own assertions about candidate trades.
export function LaterContextRegion({ contexts, add }: { contexts: Loadable<LaterContextRow[]>; add: DecisionAction<[text: string]> }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-col gap-3">
      {contexts.isError ? (
        <ErrorState message={contexts.error?.message ?? null} />
      ) : contexts.data === undefined ? (
        <Skeleton lines={2} />
      ) : contexts.data.length === 0 ? (
        <p className="text-sm text-muted">{t.laterContextEmpty}</p>
      ) : (
        <List label={t.laterContextTitle}>
          {contexts.data.map((lc) => (
            <ListRow key={lc.id}>
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted">
                  <Num>{dateTime(lc.addedAt)}</Num> · {t.addedByPrefix} {addedByLabel[lc.addedBy] ?? "—"}
                </p>
                <Quote>{lc.text}</Quote>
              </div>
            </ListRow>
          ))}
        </List>
      )}
      <Field label={t.laterContextLabel} help={t.laterContextHelp}>
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} className="min-h-20" value={draft} onChange={(e) => setDraft(e.target.value)} />}
      </Field>
      <Button
        size="sm"
        variant="secondary"
        className="w-fit"
        onClick={async () => {
          if (await add.run(draft)) setDraft("");
        }}
        disabled={draft.trim() === ""}
        loading={add.pending}
        loadingLabel={t.addingContextButton}
      >
        {t.addContextButton}
      </Button>
      <ActionError title={t.actionFailed} message={add.error} />
    </div>
  );
}

export function ExecutionRegion({
  execution,
  mark,
}: {
  execution: Loadable<ExecutionData>;
  mark: { run: (c: Candidate, verdict: "executed" | "unrelated") => void; pending: boolean; error: string | null };
}) {
  if (execution.isError) return <ErrorState message={execution.error?.message ?? null} onRetry={execution.refetch ? () => void execution.refetch!() : undefined} />;
  if (execution.data === undefined) return <Skeleton lines={2} />;
  return <ExecutionView data={execution.data} mark={mark.run} pending={mark.pending} error={mark.error} />;
}
