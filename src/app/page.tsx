"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { dashboardPage as t, importPage, interviewPage, journalPage, historyFreshness, dnaPage, strategyPage, ideasPage, casesListPage, decisionsListPage, decisionAttention as da, decisionTypeLabel } from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

// Reuses each destination page's own title string (imported above)
// rather than a second, parallel copy of the same eight labels — see
// dashboardPage's comment in strings.ts. Order matches the actual
// product flow (docs/architecture.md §2), not alphabetical.
const SECTIONS = [
  { href: "/import", label: importPage.title },
  { href: "/interview", label: interviewPage.title },
  // Episode Journal — its card also shows rationale coverage (derived
  // from production data by interview.journalCoverage, never hard-coded).
  { href: "/journal", label: journalPage.title },
  { href: "/dna", label: dnaPage.title },
  { href: "/strategy", label: strategyPage.title },
  { href: "/ideas", label: ideasPage.title },
  { href: "/cases", label: casesListPage.title },
  { href: "/decisions", label: decisionsListPage.title },
  // Learning Insights stays English on purpose — that page itself is
  // still English, deferred alongside Decision Review (open backlog
  // items) — see CLAUDE.md's "שפת תוכן" section.
  { href: "/learning", label: "Learning Insights" },
] as const;

export default function HomePage() {
  const router = useRouter();
  const guard = useSubmitGuard();
  const me = trpc.auth.me.useQuery();
  const coverage = trpc.interview.journalCoverage.useQuery();
  // History freshness (History Refresh V1) — the latest persisted
  // transaction date, never a claim about the live portfolio.
  const history = trpc.import.history.useQuery();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      router.push("/login");
      router.refresh();
    },
  });

  return (
    <main
      dir="rtl"
      lang="he"
      className={`${sansBody.className} mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12 text-journal-ink`}
    >
      <div className="flex flex-col gap-2 border-b border-journal-rule pb-6">
        <h1 className={`${serifHeader.className} text-2xl font-bold`}>AI Investment Copilot</h1>
        {me.isLoading && <p className="text-sm text-journal-muted">{t.loading}</p>}
        {me.data && (
          <p className="text-sm text-journal-muted">
            {t.signedInAs} <strong className="text-journal-ink">{me.data.displayName}</strong> ({me.data.email})
          </p>
        )}
        <p className="text-sm text-journal-muted">{t.description}</p>
      </div>

      <DecisionAttentionSection />

      <div className="flex flex-col gap-2">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded border border-journal-rule bg-journal-surface p-3 text-sm hover:bg-journal-bg"
          >
            {s.label}
            {s.href === "/import" && history.data?.latestTransactionDate && (
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
            {s.href === "/journal" && coverage.data && (
              <span className="text-xs text-journal-muted">
                {" — "}
                {journalPage.coveragePrefix} <Num>{coverage.data.covered}</Num> {journalPage.coverageMiddle}{" "}
                <Num>{coverage.data.total}</Num> {journalPage.coverageSuffix}
              </span>
            )}
          </Link>
        ))}
      </div>

      <button
        onClick={() => guard(() => logout.mutateAsync())}
        className="w-fit rounded border border-journal-rule px-3 py-2 text-sm text-journal-ink hover:bg-journal-bg"
      >
        {t.signOut}
      </button>
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
