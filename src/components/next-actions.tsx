"use client";

import Link from "next/link";
import { trpc } from "@/trpc/react";
import { Num } from "@/components/num";
import { nextActions as t, decisionTypeLabel } from "@/lib/i18n/strings";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

// Evidence Reach V1 — the deterministic NEXT ACTION list beside Open-Decision
// Monitoring (src/lib/next-actions/next-actions.ts). Each row is
// FACT -> REASON -> DESTINATION; a row disappears once the action is done.
// Not an attention reason and never a judgment about a decision.
type Action = inferRouterOutputs<AppRouter>["evidence"]["nextActions"][number];
const day = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");

function decisionLabel(a: Action) {
  if (!a.decision) return null;
  return (
    <>
      {decisionTypeLabel[a.decision.decisionType] ?? a.decision.decisionType} {a.decision.ticker} (<Num>{day(a.decision.decisionDate)}</Num>)
    </>
  );
}

function fact(a: Action) {
  switch (a.kind) {
    case "RESOLVE_EXECUTION_CANDIDATES":
      return (
        <>
          {t.fact.execPrefix} {decisionLabel(a)} {t.fact.execMiddle} <Num>{a.count}</Num> {t.fact.execSuffix}
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
          {t.fact.conditionPrefix} {decisionLabel(a)}
        </>
      );
    case "CONTINUE_STALLED_CASE":
      return (
        <>
          {t.fact.stalledCasePrefix} {a.ticker} {t.fact.stalledCaseSuffix}
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

export function NextActionsSection() {
  const actions = trpc.evidence.nextActions.useQuery();
  return (
    <section className="flex flex-col gap-3 rounded border border-journal-rule bg-journal-surface p-4">
      <h2 className="text-lg font-bold">{t.title}</h2>
      <p className="text-xs text-journal-muted">{t.explanation}</p>
      {actions.isLoading && <p className="text-sm text-journal-muted">{t.loading}</p>}
      {actions.isError && <p className="text-sm text-red-600">{actions.error.message}</p>}
      {actions.data && actions.data.length === 0 && <p className="text-sm text-journal-muted">{t.empty}</p>}
      {actions.data?.map((a) => (
        <div key={a.key} className="flex flex-col gap-1 rounded border border-journal-rule bg-journal-bg p-3 text-sm" data-next-action={a.kind}>
          <p>{fact(a)}</p>
          <p className="text-xs text-journal-muted">{t.reason[a.kind]}</p>
          <Link href={a.destination} className="w-fit text-xs text-journal-accent underline">
            {t.destination[a.kind]}
          </Link>
        </div>
      ))}
    </section>
  );
}
