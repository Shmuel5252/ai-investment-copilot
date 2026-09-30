"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { PageShell, PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { List, ListRow } from "@/components/ui/list";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { RegionBody } from "@/components/home/region";
import type { Loadable } from "@/components/home/types";
import { casesListPage as t, caseStatusLabel } from "@/lib/i18n/strings";
import { ActionError } from "@/components/ui/action-error";
import { day } from "./parts";
import type { CaseAction, CaseListRow } from "./types";

// /cases — the companion list of the research file (Frontend V1, unit 3).
// Facts only: ticker, status, dates, and the stalled flag the next-actions
// engine already derived (CONTINUE_STALLED_CASE). No ranking.
export function CasesListView({ cases, stalledCaseIds, create }: { cases: Loadable<CaseListRow[]>; stalledCaseIds: ReadonlySet<string>; create: CaseAction<[ticker: string]> }) {
  const [ticker, setTicker] = useState("");
  return (
    <PageShell width="narrow">
      <PageHeader title={t.title} description={t.description} />

      <Card padding="sm">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ticker.trim() !== "") create.run(ticker);
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t.tickerLabel} className="min-w-40 flex-1">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} dir="ltr" value={ticker} placeholder={t.tickerPlaceholder} onChange={(e) => setTicker(e.target.value)} />}
            </Field>
            <Button type="submit" variant="primary" disabled={ticker.trim() === ""} loading={create.pending} loadingLabel={t.creatingButton}>
              {t.createButton}
            </Button>
          </div>
          <p className="text-xs text-muted">{t.tickerHelp}</p>
          <ActionError message={create.error} title={t.createFailed} />
        </form>
      </Card>

      <Section title={t.listLabel} count={cases.data?.length}>
        <RegionBody q={cases} lines={4}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title={t.emptyTitle}>{t.emptyHint}</EmptyState>
            ) : (
              <List label={t.listLabel}>
                {rows.map((c) => (
                  <ListRow
                    key={c.id}
                    actions={
                      <ButtonLink href={`/cases/${c.id}`} size="sm" variant="quiet">
                        {t.openCase}
                      </ButtonLink>
                    }
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">
                          <Num>{c.ticker}</Num>
                        </span>
                        <Badge tone={c.status === "researching" ? "info" : "neutral"}>{caseStatusLabel[c.status] ?? c.status}</Badge>
                        {stalledCaseIds.has(c.id) && <Badge tone="caution">{t.stalled}</Badge>}
                      </div>
                      <p className="text-xs text-muted">
                        {t.openedPrefix} <Num>{day(c.createdAt)}</Num> · {t.updatedPrefix} <Num>{day(c.updatedAt)}</Num>
                      </p>
                    </div>
                  </ListRow>
                ))}
              </List>
            )
          }
        </RegionBody>
      </Section>
    </PageShell>
  );
}
