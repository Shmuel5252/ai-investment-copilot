import { Num } from "@/components/num";
import { Card } from "@/components/ui/card";
import { KeyValues } from "@/components/ui/table";
import { EmptyState, HelpText } from "@/components/ui/states";
import { RegionBody } from "@/components/home/region";
import { day, type Loadable } from "@/components/home/types";
import { historyFreshness as hf } from "@/lib/i18n/strings";
import type { HistoryData } from "./types";

// How far the stored history reaches, from import.history: plain facts for
// orientation. No score, no color, no claim that the portfolio is current.
export function HistoryStatus({ history }: { history: Loadable<HistoryData> }) {
  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-3">
      <h2 id="history-title" className="text-base font-semibold text-ink">
        {hf.title}
      </h2>
      <RegionBody q={history} lines={3}>
        {(h) => (h.latestTransactionDate ? <HistoryFacts history={h} /> : <EmptyState title={hf.noHistoryTitle}>{hf.noHistory}</EmptyState>)}
      </RegionBody>
    </section>
  );
}

function HistoryFacts({ history }: { history: HistoryData }) {
  const batch = history.latestBatch;
  const items: { label: React.ReactNode; value: React.ReactNode }[] = [
    {
      label: hf.latestTransaction,
      value: (
        <>
          <Num>{day(history.latestTransactionDate!)}</Num>
          {history.ageDays !== null && (
            <span className="text-muted">
              {" · "}
              {history.ageDays === 0 ? (
                hf.ageToday
              ) : (
                <>
                  {hf.age} <Num>{history.ageDays}</Num> {hf.ageDays}
                </>
              )}
            </span>
          )}
        </>
      ),
    },
    { label: hf.totalTransactions, value: <Num>{history.transactionCount}</Num> },
  ];
  if (batch) {
    items.push({
      label: hf.latestFile,
      value: (
        <>
          <Num>{batch.filename}</Num> · <Num>{day(batch.uploadedAt)}</Num>
        </>
      ),
    });
    if (batch.windowStart && batch.windowEnd) {
      items.push({
        label: hf.latestFileWindow,
        value: (
          <>
            <Num>{day(batch.windowStart)}</Num> {hf.to} <Num>{day(batch.windowEnd)}</Num>
          </>
        ),
      });
    }
    items.push({ label: hf.latestFileRows, value: <Num>{batch.rowCount}</Num> });
  }
  if (history.manualEntry.count > 0) {
    items.push({
      label: hf.manualEntries,
      value: (
        <>
          <Num>{history.manualEntry.count}</Num>
          {history.manualEntry.latestDate && (
            <span className="text-muted">
              {" · "}
              {hf.manualLatestPrefix}
              <Num>{day(history.manualEntry.latestDate)}</Num>
            </span>
          )}
        </>
      ),
    });
  }
  return (
    <Card className="flex flex-col gap-3">
      <KeyValues items={items} />
      <HelpText>{hf.disclaimer}</HelpText>
    </Card>
  );
}
