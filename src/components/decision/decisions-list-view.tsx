import { Num } from "@/components/num";
import { PageShell, PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { List, ListRow } from "@/components/ui/list";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { RegionBody } from "@/components/home/region";
import type { Loadable } from "@/components/home/types";
import { decisionsListPage as t, decisionTypeLabel, decisionPage } from "@/lib/i18n/strings";
import { day } from "./parts";

// /decisions — every recorded decision, newest decision date first (the
// order decisions.list returns). Facts only: type, ticker, dates. No ranking,
// no outcome, no grade.
export interface DecisionListRow {
  id: string;
  ticker: string;
  decisionType: string;
  decisionDate: string | Date;
  reviewByDate: string | Date | null;
}

export function DecisionsListView({ decisions }: { decisions: Loadable<DecisionListRow[]> }) {
  return (
    <PageShell width="narrow">
      <PageHeader title={t.title} description={t.description} />
      <Section title={t.listLabel} count={decisions.data?.length}>
        <RegionBody q={decisions} lines={4}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState
                title={t.noDecisionsYet}
                action={
                  <ButtonLink href="/cases" size="sm">
                    {t.goToCases}
                  </ButtonLink>
                }
              >
                {t.emptyHint}
              </EmptyState>
            ) : (
              <List label={t.listLabel}>
                {rows.map((d) => (
                  <ListRow
                    key={d.id}
                    actions={
                      <ButtonLink href={`/decisions/${d.id}`} size="sm" variant="quiet">
                        {t.openDecision}
                      </ButtonLink>
                    }
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">
                          {decisionTypeLabel[d.decisionType] ?? d.decisionType} <Num>{d.ticker}</Num>
                        </span>
                        <Badge tone="neutral">{decisionPage.immutableBadge}</Badge>
                      </div>
                      <p className="text-xs text-muted">
                        {decisionPage.decidedOnPrefix}
                        <Num>{day(d.decisionDate)}</Num>
                        {" · "}
                        {d.reviewByDate ? (
                          <>
                            {decisionPage.reviewByPrefix} <Num>{day(d.reviewByDate)}</Num>
                          </>
                        ) : (
                          decisionPage.noReviewDate
                        )}
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
