"use client";

import Link from "next/link";
import { trpc } from "@/trpc/react";
import { Num } from "@/components/num";
import { openConditions as t, decisionTypeLabel } from "@/lib/i18n/strings";

// Decision Follow-Through V1 — the dashboard's list of open re-entry
// conditions: the checks the investor set for themselves on earlier
// decisions, listed as facts (Pull). Not an attention reason (the monitoring's
// four reasons are untouched) and never checked against the market — the
// investor decides whether a condition fired, on the decision page.
export function OpenConditionsSection() {
  const open = trpc.predictions.openReentryConditions.useQuery();
  return (
    <section className="flex flex-col gap-3 rounded border border-journal-rule bg-journal-surface p-4">
      <h2 className="text-lg font-bold">{t.title}</h2>
      <p className="text-xs text-journal-muted">{t.explanation}</p>
      {open.isLoading && <p className="text-sm text-journal-muted">{t.loading}</p>}
      {open.isError && <p className="text-sm text-red-600">{open.error.message}</p>}
      {open.data && open.data.length === 0 && <p className="text-sm text-journal-muted">{t.empty}</p>}
      {open.data?.map((c) => (
        <div key={c.predictionId} className="flex flex-col gap-1 rounded border border-journal-rule bg-journal-bg p-3 text-sm">
          <p>{c.claimText}</p>
          <p className="text-xs text-journal-muted">
            {t.fromDecisionPrefix} {decisionTypeLabel[c.decisionType] ?? c.decisionType} {c.ticker}{" "}
            <Num>{new Date(c.decisionDate).toLocaleDateString("he-IL")}</Num>
            {c.checkableByDate && (
              <>
                {" · "}
                {t.checkableByPrefix} <Num>{new Date(c.checkableByDate).toLocaleDateString("he-IL")}</Num>
              </>
            )}
            {" · "}
            <Link href={`/decisions/${c.decisionId}#predictions`} className="text-journal-accent underline">
              {t.openDecision}
            </Link>
          </p>
        </div>
      ))}
    </section>
  );
}
