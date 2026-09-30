"use client";

import Link from "next/link";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { Num } from "@/components/num";
import { OpenConditionsSection } from "@/components/open-conditions";
import { NextActionsSection } from "@/components/next-actions";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { dashboardPage as t, importPage, journalPage, historyFreshness, decisionAttention as da, decisionTypeLabel } from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

// Frontend V1, unit 1: the app shell (src/components/shell) now owns the
// navigation, the signed-in name and sign-out, so the Dashboard no longer
// repeats them. The two status rows below stay because they are the
// Dashboard's own facts, not navigation: how fresh the imported history is
// and how much of the position journal has a rationale. Everything else on
// this page is untouched until the Home redesign unit.
export default function HomePage() {
  const coverage = trpc.interview.journalCoverage.useQuery();
  // History freshness (History Refresh V1) — the latest persisted
  // transaction date, never a claim about the live portfolio.
  const history = trpc.import.history.useQuery();

  return (
    <main className={`${sansBody.className} mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12 text-journal-ink`}>
      <div className="flex flex-col gap-2 border-b border-journal-rule pb-6">
        <h1 className={`${serifHeader.className} text-2xl font-bold`}>AI Investment Copilot</h1>
        <p className="text-sm text-journal-muted">{t.description}</p>
      </div>

      <DecisionAttentionSection />
      <NextActionsSection />
      <OpenConditionsSection />

      <div className="flex flex-col gap-2">
        <Link href="/import" className="rounded border border-journal-rule bg-journal-surface p-3 text-sm hover:bg-journal-bg">
          {importPage.title}
          {history.data?.latestTransactionDate && (
            <span className="text-xs text-journal-muted">
              {" — "}
              {historyFreshness.upToDatePrefix} <Num>{new Date(history.data.latestTransactionDate).toLocaleDateString("he-IL")}</Num>
              {history.data.ageDays !== null && history.data.ageDays > 0 && (
                <>
                  {" · "}
                  {historyFreshness.agePrefix} <Num>{history.data.ageDays}</Num> {historyFreshness.ageSuffixDays}
                </>
              )}
            </span>
          )}
        </Link>
        <Link href="/journal" className="rounded border border-journal-rule bg-journal-surface p-3 text-sm hover:bg-journal-bg">
          {journalPage.title}
          {coverage.data && (
            <span className="text-xs text-journal-muted">
              {" — "}
              {journalPage.coveragePrefix} <Num>{coverage.data.covered}</Num> {journalPage.coverageMiddle}{" "}
              <Num>{coverage.data.total}</Num> {journalPage.coverageSuffix}
            </span>
          )}
        </Link>
      </div>
    </main>
  );
}

// Open-Decision Monitoring V1 — the ONE attention section (docs/architecture.md
// §2.9). Everything here is a derived fact from decisions.attention; the
// wording never asserts that a transaction executed a decision, and a PASS
// never gets a price/counterfactual line.
type AttentionItem = inferRouterOutputs<AppRouter>["decisions"]["attention"]["attention"][number];
type ExecutionFact = AttentionItem["newExecutionAfterDecision"][number];
const day = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");
const latestPersisted = (facts: ExecutionFact[]) => new Date(Math.max(...facts.map((f) => new Date(f.persistedAt).getTime())));

function FactList({ facts }: { facts: ExecutionFact[] }) {
  return (
    <span>
      {facts.map((f, i) => (
        <span key={f.transactionId}>
          {i > 0 && " · "}
          {da.txnType[f.transactionType] ?? f.transactionType}{" "}
          <Num>
            {f.quantity ?? "?"} @ {f.price !== null ? "$" + Number(f.price).toFixed(2) : "?"}
          </Num>{" "}
          (<Num>{day(f.transactionDate)}</Num>)
        </span>
      ))}
    </span>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const href = `/decisions/${item.decisionId}`;
  return (
    <div className="flex flex-col gap-1 rounded border border-journal-rule bg-journal-bg p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {decisionTypeLabel[item.decisionType] ?? item.decisionType} {item.ticker}
        </span>
        <span className="text-xs text-journal-muted">
          <Num>{day(item.decisionDate)}</Num>
        </span>
        {item.reasons.map((r) => (
          <span key={r} className="rounded border border-journal-rule px-2 py-0.5 text-xs">
            {da.reason[r] ?? r}
          </span>
        ))}
      </div>
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
          <Num>{item.newExecutionAfterDecision.length}</Num> {da.newExecutionFactMiddle}{item.ticker} {da.newExecutionFactSuffix}
          <Num>{day(latestPersisted(item.newExecutionAfterDecision))}</Num>: <FactList facts={item.newExecutionAfterDecision} />
        </p>
      )}
      {item.reasons.includes("HISTORY_BACKFILLED") && (
        <p>
          <Num>{item.backfilled.length}</Num> {da.backfilledFactMiddle}{item.ticker} {da.backfilledFactSuffix}
          <Num>{day(latestPersisted(item.backfilled))}</Num>: <FactList facts={item.backfilled} />. {da.backfilledNote}
        </p>
      )}
      {item.execution.sameDay.length > 0 && (
        <p className="text-xs text-journal-muted">
          <Num>{item.execution.sameDay.length}</Num> {da.sameDayFact}
        </p>
      )}
      {item.execution.status === "history_before_decision" && (
        <p className="text-xs text-journal-muted">
          {da.executionUnavailablePrefix} {item.execution.historyThrough ? <Num>{day(item.execution.historyThrough)}</Num> : "—"}
        </p>
      )}
      <p className="text-xs text-journal-muted">
        {item.position.status === "ok" ? (
          item.position.held ? (
            <>
              {da.heldPrefix} <Num>{item.position.quantity} @ {item.position.costBasisPerShare !== null ? "$" + item.position.costBasisPerShare.toFixed(2) : "?"}</Num>
              {item.position.episodeKeys.length > 0 && <> · {item.position.episodeKeys.join(", ")}</>}
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
            {da.frozenHoldingPrefix} <Num>{item.position.frozenHoldingQuantity}</Num>
          </>
        )}
      </p>
      <p className="flex flex-wrap gap-3 text-xs">
        <Link href={href} className="text-journal-accent underline">
          {da.openDecision}
        </Link>
        <Link href={`${href}#later-context`} className="text-journal-accent underline">
          {da.addContext}
        </Link>
        <Link href={`${href}#review`} className="text-journal-accent underline">
          {da.runReview}
        </Link>
        {item.execution.after.length + item.execution.sameDay.length + item.execution.backfilledBefore.length > 0 && (
          <Link href={`${href}#execution`} className="text-journal-accent underline">
            {da.markExecution}
          </Link>
        )}
      </p>
    </div>
  );
}

function DecisionAttentionSection() {
  // The zone every date on this page is rendered in — the server places
  // decision/review instants on this same calendar (no defaulted zone).
  const attention = trpc.decisions.attention.useQuery({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return (
    <section className="flex flex-col gap-3 rounded border border-journal-rule bg-journal-surface p-4">
      <h2 className={`${serifHeader.className} text-lg font-bold`}>{da.title}</h2>
      {attention.isLoading && <p className="text-sm text-journal-muted">{da.loading}</p>}
      {attention.isError && <p className="text-sm text-red-600">{attention.error.message}</p>}
      {attention.data && attention.data.attention.length === 0 && (
        <p className="text-sm text-journal-muted">
          {da.empty} ·{" "}
          {attention.data.historyThrough ? (
            <>
              {da.historyThroughPrefix} <Num>{day(attention.data.historyThrough)}</Num>
            </>
          ) : (
            da.noHistory
          )}
        </p>
      )}
      {attention.data?.attention.map((item) => <AttentionCard key={item.decisionId} item={item} />)}
      {attention.data && attention.data.monitoredWithoutHorizon > 0 && (
        <p className="text-xs text-journal-muted">
          <Num>{attention.data.monitoredWithoutHorizon}</Num> {da.withoutHorizonSuffix}
        </p>
      )}
    </section>
  );
}
