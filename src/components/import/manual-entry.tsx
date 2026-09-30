"use client";

import { Num } from "@/components/num";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { List, ListRow } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { KeyValues } from "@/components/ui/table";
import { HelpText } from "@/components/ui/states";
import { day, type Loadable } from "@/components/home/types";
import { RegionBody } from "@/components/home/region";
import { importPage as t, manualEntryPage as m } from "@/lib/i18n/strings";
import { OrderingSection, ReconciliationSection, orderingGroups, skippedKeys, unresolvedCount } from "./reconciliation";
import { JournalNext, Positions, WriteFailure } from "./file-steps";
import type { ManualResultView, ManualRowDraft, ResolutionDraft, ValidationData, WriteError } from "./types";

// Manual entry on /import: the existing fields, the same reconciliation and
// same-day ordering as the file path, one all-or-nothing save
// (confirmManualEntry). The amount is never entered here; the server
// computes it from quantity and price.

export type ManualCheck = Pick<ValidationData, "collisionGroups" | "reconciliation">;
const formLine = (clientRowKey: string) => Number(clientRowKey) + 1;

export function emptyManualRow(): ManualRowDraft {
  return { ticker: "", transactionType: "buy", quantity: "", price: "", transactionDate: new Date().toISOString().slice(0, 10), notes: "", intraDayOrder: "" };
}

/** checkManualEntry runs only when every row is complete: rows are keyed by position, so none can be dropped. */
export const manualRowsComplete = (rows: readonly ManualRowDraft[]) =>
  rows.length > 0 && rows.every((r) => r.ticker.trim() !== "" && Number(r.quantity) > 0 && Number(r.price) > 0 && r.transactionDate !== "");

export interface ManualActions {
  submit: () => void;
  pending: boolean;
  error: WriteError | null;
  needsRefresh: boolean;
  refresh: () => void;
  refreshing: boolean;
}

export function ManualEntryForm({
  rows,
  onRow,
  onAdd,
  onRemove,
  check,
  resolutions,
  onResolution,
  actions,
}: {
  rows: ManualRowDraft[];
  onRow: (index: number, patch: Partial<ManualRowDraft>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** null until every row is complete. */
  check: Loadable<ManualCheck> | null;
  resolutions: Record<string, ResolutionDraft>;
  onResolution: (clientRowKey: string, draft: ResolutionDraft) => void;
  actions: ManualActions;
}) {
  const data = check?.data;
  const groups = data ? orderingGroups(data.collisionGroups, skippedKeys(data.reconciliation, resolutions)) : [];
  const unresolved = unresolvedCount(data?.reconciliation, resolutions);
  const describe = (k: string) => {
    const r = rows[Number(k)];
    return r ? `${r.ticker.trim()} · ${r.transactionType === "buy" ? m.buyOption : m.sellOption} · ${r.quantity} @ $${r.price}` : "";
  };
  const orders = Object.fromEntries(rows.map((r, i) => [String(i), r.intraDayOrder]));
  const blocked = unresolved > 0 || actions.needsRefresh;

  return (
    <Section id="manual" title={m.title} hint={m.description}>
      <List label={m.title}>
        {rows.map((row, index) => (
          <ListRow key={index}>
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-semibold text-ink">
                {m.rowTitle} <Num>{index + 1}</Num>
              </legend>
              <div className="grid gap-3 sm:grid-cols-5">
                <Field label={m.tickerLabel}>
                  {({ id }) => <Input id={id} dir="ltr" value={row.ticker} onChange={(e) => onRow(index, { ticker: e.target.value })} />}
                </Field>
                <Field label={m.typeLabel}>
                  {({ id }) => (
                    <Select id={id} value={row.transactionType} onChange={(e) => onRow(index, { transactionType: e.target.value as ManualRowDraft["transactionType"] })}>
                      <option value="buy">{m.buyOption}</option>
                      <option value="sell">{m.sellOption}</option>
                    </Select>
                  )}
                </Field>
                <Field label={m.quantityLabel}>
                  {({ id }) => <Input id={id} type="number" step="any" value={row.quantity} onChange={(e) => onRow(index, { quantity: e.target.value })} />}
                </Field>
                <Field label={m.priceLabel}>
                  {({ id }) => <Input id={id} type="number" step="any" value={row.price} onChange={(e) => onRow(index, { price: e.target.value })} />}
                </Field>
                <Field label={m.dateLabel}>
                  {({ id }) => <Input id={id} type="date" value={row.transactionDate} onChange={(e) => onRow(index, { transactionDate: e.target.value })} />}
                </Field>
              </div>
              <Field label={m.notesLabel}>
                {({ id }) => <Input id={id} placeholder={m.notesPlaceholder} value={row.notes} onChange={(e) => onRow(index, { notes: e.target.value })} />}
              </Field>
              <div>
                <Button size="sm" variant="quiet" onClick={() => onRemove(index)} disabled={rows.length === 1}>
                  {m.removeRowButton}
                </Button>
              </div>
            </fieldset>
          </ListRow>
        ))}
      </List>
      <div>
        <Button variant="secondary" onClick={onAdd}>
          {m.addRowButton}
        </Button>
      </div>

      {check === null ? (
        <HelpText>{m.incompleteNote}</HelpText>
      ) : (
        <RegionBody q={check} lines={3}>
          {(d) => (
            <>
              <ReconciliationSection reconciliation={d.reconciliation} drafts={resolutions} onChange={onResolution} rowLabel={formLine} />
              <OrderingSection groups={groups} orders={orders} onOrder={(k, v) => onRow(Number(k), { intraDayOrder: v })} describe={describe} rowLabel={formLine} />
            </>
          )}
        </RegionBody>
      )}

      <Card className="flex flex-col gap-3">
        {blocked && <p className="text-sm text-ink-2">{actions.needsRefresh ? t.blockedRefresh : t.blockedUnresolved}</p>}
        <div>
          <Button variant="primary" onClick={actions.submit} disabled={blocked} loading={actions.pending} loadingLabel={m.savingButton}>
            {m.submitButton}
          </Button>
        </div>
        <WriteFailure error={actions.error} refresh={actions.refresh} refreshing={actions.refreshing} body={t.manualUncertainBody} />
      </Card>
    </Section>
  );
}

export function ManualEntryDone({ result, onMore }: { result: ManualResultView; onMore: () => void }) {
  const counts = [{ label: m.savedCountLabel, value: <Num>{result.transactions.length}</Num> }];
  if (result.skippedCount > 0) counts.push({ label: m.skippedCountLabel, value: <Num>{result.skippedCount}</Num> });
  return (
    <Section id="manual-done" title={m.savedTitle}>
      <KeyValues items={counts} />
      {result.transactions.length > 0 && (
        <List label={m.savedTitle}>
          {result.transactions.map((txn) => (
            <ListRow key={txn.id}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-ink">
                  <Num>{txn.ticker}</Num> · {txn.transactionType === "buy" ? m.buyOption : m.sellOption} · <Num>{`${txn.quantity} @ $${Number(txn.price).toFixed(2)}`}</Num> ·{" "}
                  <Num>{day(txn.transactionDate)}</Num>
                </p>
                <Badge>{m.provenance}</Badge>
              </div>
            </ListRow>
          ))}
        </List>
      )}
      <Positions positions={result.positions} />
      {result.transactions.length > 0 && <JournalNext text={m.journalNext} />}
      <div>
        <Button variant="secondary" onClick={onMore}>
          {m.enterMoreButton}
        </Button>
      </div>
    </Section>
  );
}
