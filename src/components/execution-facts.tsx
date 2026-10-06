"use client";

import { Num, shares } from "@/components/num";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { List, ListRow } from "@/components/ui/list";
import { Notice } from "@/components/ui/status";
import { HelpText } from "@/components/ui/states";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { decisionExecution as t, decisionAttention as da } from "@/lib/i18n/strings";

// Decision Follow-Through V1 — "ביצוע בפועל" on the decision page. Every
// trade shown is a CANDIDATE from the monitoring's own execution groups; the
// wording never claims a trade executed the decision until the investor
// marks it, and the server decides what can be marked (side, day, PASS/HOLD).
// Frontend V1 unit 4: presentation only, restyled on the shared primitives.
// The decision page owns executions.candidates and executions.assert; the
// assertion payload is unchanged.
type Candidates = inferRouterOutputs<AppRouter>["executions"]["candidates"];
export type Candidate = Pick<
  Candidates["candidates"][number],
  "group" | "transactionId" | "transactionType" | "transactionDate" | "quantity" | "price" | "episodeKey" | "canExecute" | "assertion"
>;
export interface ExecutionData {
  executedSide: Candidates["executedSide"];
  status: Candidates["status"];
  historyThrough: Candidates["historyThrough"];
  candidates: Candidate[];
  executed: { id: string; note: string | null; transaction: { transactionType: string; quantity: number | null; price: number | null; transactionDate: string | Date; amount: number } }[];
  unrelatedCount: number;
}

const day = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");

function TradeLine({ transactionType, quantity, price, transactionDate }: { transactionType: string; quantity: number | null; price: number | null; transactionDate: string | Date }) {
  return (
    <span>
      {da.txnType[transactionType] ?? transactionType}{" "}
      <Num>
        {shares(quantity)} @ {price !== null ? "$" + Number(price).toFixed(2) : "?"}
      </Num>{" "}
      (<Num>{day(transactionDate)}</Num>)
    </span>
  );
}


export function ExecutionView({
  data,
  mark,
  pending,
  error,
}: {
  data: ExecutionData;
  mark: (c: Candidate, verdict: "executed" | "unrelated") => void;
  pending: boolean;
  error: string | null;
}) {
  const around = data.candidates.filter((c) => c.group === "after" || c.group === "sameDay");
  const before = data.candidates.filter((c) => c.group === "backfilledBefore" || c.group === "knownBefore");

  return (
    <div className="flex flex-col gap-3 text-sm">
      <HelpText>{t.explanation}</HelpText>
      {data.executedSide === null && <HelpText>{t.notExecutableNote}</HelpText>}
      {data.executed.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-ink-2">{t.executedTitle}</p>
          <List label={t.executedTitle}>
            {data.executed.map((f) => (
              <ListRow key={f.id}>
                <TradeLine {...f.transaction} /> · {t.amountLabel} <Num>${Math.abs(f.transaction.amount).toFixed(2)}</Num>
                {f.note && <span className="block text-xs text-muted">{f.note}</span>}
              </ListRow>
            ))}
          </List>
        </div>
      )}
      {data.status === "history_before_decision" && (
        <p className="text-xs text-muted">
          {data.historyThrough ? (
            <>
              {t.historyBeforeDecisionPrefix} <Num>{day(data.historyThrough)}</Num>
            </>
          ) : (
            t.noHistory
          )}
        </p>
      )}
      {data.status === "available" && around.length === 0 && before.length === 0 && <p className="text-xs text-muted">{t.noCandidates}</p>}
      {around.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-ink-2">{t.candidatesTitle}</p>
          <List label={t.candidatesTitle}>
            {around.map((c) => (
              <CandidateRow key={c.transactionId} c={c} mark={mark} pending={pending} executedSide={data.executedSide} />
            ))}
          </List>
        </div>
      )}
      {before.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-ink-2">{t.beforeTitle}</p>
          <HelpText>{t.beforeNote}</HelpText>
          <List label={t.beforeTitle}>
            {before.map((c) => (
              <CandidateRow key={c.transactionId} c={c} mark={mark} pending={pending} executedSide={data.executedSide} />
            ))}
          </List>
        </div>
      )}
      {data.unrelatedCount > 0 && (
        <p className="text-xs text-muted">
          <Num>{data.unrelatedCount}</Num> {t.unrelatedCountSuffix}
        </p>
      )}
      {error && (
        <Notice tone="negative">
          <bdi dir="ltr" className="text-xs">
            {error}
          </bdi>
        </Notice>
      )}
    </div>
  );
}

function CandidateRow({ c, mark, pending, executedSide }: { c: Candidate; mark: (c: Candidate, verdict: "executed" | "unrelated") => void; pending: boolean; executedSide: "buy" | "sell" | null }) {
  const verdict = c.assertion?.verdict ?? null;
  const groupNote = c.group === "sameDay" ? t.sameDayNote : c.group === "after" ? t.afterNote : null;
  return (
    <ListRow
      actions={
        <>
          {verdict !== "executed" && c.canExecute && (
            <Button size="sm" variant="secondary" onClick={() => mark(c, "executed")} disabled={pending}>
              {pending ? t.markingButton : verdict === "unrelated" ? t.changeToExecuted : t.markExecuted}
            </Button>
          )}
          {verdict !== "unrelated" && (
            <Button size="sm" variant="quiet" onClick={() => mark(c, "unrelated")} disabled={pending}>
              {pending ? t.markingButton : verdict === "executed" ? t.changeToUnrelated : t.markUnrelated}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <p>
          <TradeLine {...c} />
          {c.episodeKey && (
            <span className="text-xs text-muted">
              {" · "}
              <bdi dir="ltr">{c.episodeKey}</bdi>
            </span>
          )}
          {groupNote && <span className="text-xs text-muted"> · {groupNote}</span>}
        </p>
        {verdict === "executed" && <Badge tone="info">{t.verdictExecuted}</Badge>}
        {verdict === "unrelated" && <Badge tone="neutral">{t.verdictUnrelated}</Badge>}
        {executedSide !== null && c.transactionType !== executedSide && verdict === null && (c.group === "after" || c.group === "sameDay") && (
          <p className="text-xs text-muted">{t.sideMismatchNote}</p>
        )}
      </div>
    </ListRow>
  );
}
