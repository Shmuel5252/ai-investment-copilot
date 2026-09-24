"use client";

import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { decisionExecution as t, decisionAttention as da } from "@/lib/i18n/strings";

// Decision Follow-Through V1 — "ביצוע בפועל" on the decision page. Every
// trade shown is a CANDIDATE from the monitoring's own execution groups; the
// wording never claims a trade executed the decision until the investor
// marks it, and the server decides what can be marked (side, day, PASS/HOLD).
type Candidates = inferRouterOutputs<AppRouter>["executions"]["candidates"];
type Candidate = Candidates["candidates"][number];

const day = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");

function TradeLine({ transactionType, quantity, price, transactionDate }: { transactionType: string; quantity: number | null; price: number | null; transactionDate: string | Date }) {
  return (
    <span>
      {da.txnType[transactionType] ?? transactionType}{" "}
      <Num>
        {quantity ?? "?"} @ {price !== null ? "$" + Number(price).toFixed(2) : "?"}
      </Num>{" "}
      (<Num>{day(transactionDate)}</Num>)
    </span>
  );
}

export function ExecutionSection({ decisionId }: { decisionId: string }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const candidates = trpc.executions.candidates.useQuery({ decisionId, timeZone });
  const assert = trpc.executions.assert.useMutation({
    onSuccess: () => {
      utils.executions.candidates.invalidate({ decisionId, timeZone });
    },
  });
  const mark = (c: Candidate, verdict: "executed" | "unrelated") =>
    guard(
      () =>
        assert.mutateAsync({
          decisionId,
          transactionId: c.transactionId,
          verdict,
          timeZone,
          supersedesFactId: c.assertion?.factId,
          shownBasis: { group: c.group, transactionType: c.transactionType, transactionDate: c.transactionDate, quantity: c.quantity, price: c.price },
        }),
      `mark-${c.transactionId}-${verdict}`
    );

  const data = candidates.data;
  const around = data?.candidates.filter((c) => c.group === "after" || c.group === "sameDay") ?? [];
  const before = data?.candidates.filter((c) => c.group === "backfilledBefore" || c.group === "knownBefore") ?? [];

  return (
    <section id="execution" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{t.title}</h2>
      <p className="text-xs text-journal-muted">{t.explanation}</p>
      {candidates.isLoading && <p className="text-sm text-journal-muted">{t.loading}</p>}
      {candidates.isError && <p className="text-sm text-red-600">{candidates.error.message}</p>}
      {data && (
        <>
          {data.executedSide === null && <p className="text-xs text-journal-muted">{t.notExecutableNote}</p>}
          {data.executed.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-xs font-semibold text-journal-muted">{t.executedTitle}</p>
              <ul className="flex flex-col gap-1">
                {data.executed.map((f) => (
                  <li key={f.id}>
                    <TradeLine {...f.transaction} /> · {t.amountLabel} <Num>${Math.abs(f.transaction.amount).toFixed(2)}</Num>
                    {f.note && <span className="text-xs text-journal-muted"> · {f.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.status === "history_before_decision" && (
            <p className="text-xs text-journal-muted">
              {data.historyThrough ? (
                <>
                  {t.historyBeforeDecisionPrefix} <Num>{day(data.historyThrough)}</Num>
                </>
              ) : (
                t.noHistory
              )}
            </p>
          )}
          {data.status === "available" && around.length === 0 && before.length === 0 && (
            <p className="text-xs text-journal-muted">{t.noCandidates}</p>
          )}
          {around.length > 0 && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-xs font-semibold text-journal-muted">{t.candidatesTitle}</p>
              {around.map((c) => (
                <CandidateRow key={c.transactionId} c={c} mark={mark} pending={assert.isPending} executedSide={data.executedSide} />
              ))}
            </div>
          )}
          {before.length > 0 && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-xs font-semibold text-journal-muted">{t.beforeTitle}</p>
              <p className="text-xs text-journal-muted">{t.beforeNote}</p>
              {before.map((c) => (
                <CandidateRow key={c.transactionId} c={c} mark={mark} pending={assert.isPending} executedSide={data.executedSide} />
              ))}
            </div>
          )}
          {data.unrelatedCount > 0 && (
            <p className="text-xs text-journal-muted">
              <Num>{data.unrelatedCount}</Num> {t.unrelatedCountSuffix}
            </p>
          )}
          {assert.isError && <p className="text-sm text-red-600">{assert.error.message}</p>}
        </>
      )}
    </section>
  );
}

function CandidateRow({ c, mark, pending, executedSide }: { c: Candidate; mark: (c: Candidate, verdict: "executed" | "unrelated") => void; pending: boolean; executedSide: "buy" | "sell" | null }) {
  const verdict = c.assertion?.verdict ?? null;
  const groupNote = c.group === "sameDay" ? t.sameDayNote : c.group === "after" ? t.afterNote : null;
  return (
    <div className="flex flex-col gap-1 rounded border border-journal-rule bg-journal-bg p-2">
      <p>
        <TradeLine {...c} />
        {c.episodeKey && <span className="text-xs text-journal-muted"> · {c.episodeKey}</span>}
        {groupNote && <span className="text-xs text-journal-muted"> · {groupNote}</span>}
      </p>
      {verdict === "executed" && <p className="text-xs text-journal-accent">{t.verdictExecuted}</p>}
      {verdict === "unrelated" && <p className="text-xs text-journal-muted">{t.verdictUnrelated}</p>}
      {executedSide !== null && c.transactionType !== executedSide && verdict === null && (c.group === "after" || c.group === "sameDay") && (
        <p className="text-xs text-journal-muted">{t.sideMismatchNote}</p>
      )}
      <div className="flex flex-wrap gap-2 text-xs">
        {verdict !== "executed" && c.canExecute && (
          <button onClick={() => mark(c, "executed")} disabled={pending} className="rounded border border-journal-rule px-2 py-1 hover:bg-journal-surface disabled:opacity-50">
            {pending ? t.markingButton : verdict === "unrelated" ? t.changeToExecuted : t.markExecuted}
          </button>
        )}
        {verdict !== "unrelated" && (
          <button onClick={() => mark(c, "unrelated")} disabled={pending} className="rounded border border-journal-rule px-2 py-1 hover:bg-journal-surface disabled:opacity-50">
            {pending ? t.markingButton : verdict === "executed" ? t.changeToUnrelated : t.markUnrelated}
          </button>
        )}
      </div>
    </div>
  );
}
