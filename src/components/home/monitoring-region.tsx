import Link from "next/link";
import { Num, shares } from "@/components/num";
import { Table, THead, TBody, Tr, Th, Td } from "@/components/ui/table";
import { List, ListRow } from "@/components/ui/list";
import { Status } from "@/components/ui/status";
import type { Tone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { decisionTypeLabel, decisionAttention as da, homePage as t } from "@/lib/i18n/strings";
import { day, type MonitoringItem } from "./types";

// D — every recorded decision with the monitoring engine's derived state, in
// the engine's order. Deterministic facts only: no price, no outcome, no
// score. A table on wide screens, stacked rows on narrow ones.

const STATE_TONE: Record<string, Tone> = { attention: "caution", monitoring: "info", settled: "neutral" };

function Horizon({ item }: { item: MonitoringItem }) {
  const label = t.horizon[item.horizon.status] ?? item.horizon.status;
  return (
    <>
      {label}
      {item.horizon.reviewByDate && item.horizon.status !== "not_set" && (
        <>
          {" · "}
          <Num>{day(item.horizon.reviewByDate)}</Num>
        </>
      )}
    </>
  );
}

function Pending({ item }: { item: MonitoringItem }) {
  return (
    <>
      <Num>{item.predictions.pending}</Num>
      {item.predictions.undated > 0 && (
        <span className="text-muted">
          {" "}
          (<Num>{item.predictions.undated}</Num> {t.undatedSuffix})
        </span>
      )}
    </>
  );
}

function Held({ item }: { item: MonitoringItem }) {
  if (item.position.held === null) return <span className="text-muted">{t.heldUnknown}</span>;
  if (!item.position.held) return <>{t.heldNo}</>;
  return (
    <>
      {t.heldYes} · <Num>{shares(item.position.quantity)}</Num>
    </>
  );
}

const name = (item: MonitoringItem) => (
  <>
    {decisionTypeLabel[item.decisionType] ?? item.decisionType} <Num>{item.ticker}</Num>
  </>
);

export function MonitoringView({ items }: { items: MonitoringItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState title={t.monitoringEmpty}>
        <Link href="/cases" className="text-accent underline">
          {t.researchTitle}
        </Link>
      </EmptyState>
    );
  }
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <THead>
            <Tr>
              <Th>{t.columns.decision}</Th>
              <Th numeric>{t.columns.date}</Th>
              <Th>{t.columns.state}</Th>
              <Th>{t.columns.reviewBy}</Th>
              <Th numeric>{t.columns.reviews}</Th>
              <Th numeric>{t.columns.pending}</Th>
              <Th>{t.columns.held}</Th>
            </Tr>
          </THead>
          <TBody>
            {items.map((item) => (
              <Tr key={item.decisionId}>
                <Td>
                  <Link href={`/decisions/${item.decisionId}`} className="font-semibold text-ink hover:text-accent hover:underline">
                    {name(item)}
                  </Link>
                </Td>
                <Td numeric muted>
                  <Num>{day(item.decisionDate)}</Num>
                </Td>
                <Td>
                  <Status tone={STATE_TONE[item.state] ?? "neutral"}>{t.state[item.state] ?? item.state}</Status>
                </Td>
                <Td>
                  <Horizon item={item} />
                </Td>
                <Td numeric>
                  <Num>{item.review.count}</Num>
                </Td>
                <Td numeric>
                  <Pending item={item} />
                </Td>
                <Td>
                  <Held item={item} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
      <List label={t.monitoringTitle} className="md:hidden">
        {items.map((item) => (
          <ListRow
            key={item.decisionId}
            actions={
              <ButtonLink href={`/decisions/${item.decisionId}`} size="sm" variant="quiet">
                {da.openDecision}
              </ButtonLink>
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink">{name(item)}</span>
              <Status tone={STATE_TONE[item.state] ?? "neutral"}>{t.state[item.state] ?? item.state}</Status>
            </div>
            <p className="num mt-1 text-xs text-muted">
              <Num>{day(item.decisionDate)}</Num> · {t.columns.reviewBy}: <Horizon item={item} /> · {t.columns.reviews}: <Num>{item.review.count}</Num>
            </p>
            <p className="num text-xs text-muted">
              {t.columns.pending}: <Pending item={item} /> · {t.columns.held}: <Held item={item} />
            </p>
          </ListRow>
        ))}
      </List>
    </>
  );
}
