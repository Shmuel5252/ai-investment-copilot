"use client";

import { Num } from "@/components/num";
import { Section } from "@/components/ui/section";
import { List, ListRow } from "@/components/ui/list";
import { KeyValues } from "@/components/ui/table";
import { Notice } from "@/components/ui/status";
import { HelpText } from "@/components/ui/states";
import { Input, Select } from "@/components/ui/field";
import { day } from "@/components/home/types";
import { collisionResolution as cr, manualEntryPage as m, reconciliation as rc } from "@/lib/i18n/strings";
import type { CollisionGroup, Reconciliation, ReconciliationRow, ResolutionDraft } from "./types";

// Reconciliation and same-day ordering on /import, shared by the file review
// and manual entry. Both only collect the investor's answers; the server
// re-derives everything under its locks at confirm time.

const typeLabel = (type: string) => (type === "buy" ? m.buyOption : type === "sell" ? m.sellOption : type);

export function rowFacts(f: ReconciliationRow["incoming"] | ReconciliationRow["candidates"][number]) {
  const trade = f.quantity !== null && f.price !== null ? `${f.quantity} @ $${Number(f.price).toFixed(2)}` : `$${Number(f.amount).toFixed(2)}`;
  return `${f.ticker ?? "—"} · ${typeLabel(f.transactionType)} · ${day(f.transactionDate)} · ${trade}`;
}

/** Rows still missing a complete answer. Mirrors planInsertions, which refuses the whole batch otherwise. */
export function unresolvedCount(reconciliation: Reconciliation | undefined, drafts: Record<string, ResolutionDraft>) {
  if (!reconciliation) return 0;
  return reconciliation.rows.filter((r) => {
    if (!r.requiresResolution) return false;
    const d = drafts[r.clientRowKey];
    if (!d) return true;
    return d.action === "same" && r.class !== "exact_duplicate" && !d.existingTransactionId;
  }).length;
}

export function toResolutionPayload(reconciliation: Reconciliation | undefined, drafts: Record<string, ResolutionDraft>) {
  if (!reconciliation) return [];
  return reconciliation.rows
    .filter((r) => r.requiresResolution && drafts[r.clientRowKey])
    .map((r) => {
      const d = drafts[r.clientRowKey]!;
      return {
        clientRowKey: r.clientRowKey,
        identityKey: r.identityKey,
        action: d.action,
        existingTransactionId: d.action === "same" && r.class !== "exact_duplicate" ? d.existingTransactionId : undefined,
      };
    });
}

/** Rows the reconciliation will not insert: an exact duplicate skipped without a question, or a row answered "same". */
export function skippedKeys(reconciliation: Reconciliation | undefined, drafts: Record<string, ResolutionDraft>) {
  return new Set(
    (reconciliation?.rows ?? []).filter((r) => (r.class === "exact_duplicate" && !r.requiresResolution) || drafts[r.clientRowKey]?.action === "same").map((r) => r.clientRowKey)
  );
}

export type OrderingKind = "declarable" | "existing" | "existing_ordered";

/**
 * The same-day groups that still hold an ambiguity once skipped rows are
 * removed, with what confirmTransactionsWithOrdering will do with each:
 *   - declarable: only new rows; distinct numbers for all of them are
 *     honored, anything less stores the group with an unknown order;
 *   - existing: a stored row is in the group; a declaration would be
 *     refused, so none is offered and the group is stored as never recorded;
 *   - existing_ordered: a stored row already carries an order; confirm
 *     refuses any new row in this group.
 */
export function orderingGroups(groups: readonly CollisionGroup[], skipped: ReadonlySet<string>) {
  return groups
    .map((g) => ({ group: g, keys: g.incoming.map((i) => i.clientRowKey).filter((k) => !skipped.has(k)) }))
    .filter(({ group, keys }) => keys.length > 0 && group.existing.length + keys.length > 1)
    .map(({ group, keys }) => ({
      group,
      keys,
      kind: (group.existing.length === 0 ? "declarable" : group.existing.some((e) => e.intraDayOrder !== null) ? "existing_ordered" : "existing") as OrderingKind,
    }));
}

/** clientRowKeys whose order may be sent: only rows in groups that can take a declaration. */
export function declarableKeys(groups: ReturnType<typeof orderingGroups>) {
  return new Set(groups.filter((g) => g.kind === "declarable").flatMap((g) => g.keys));
}

export function ReconciliationSection({
  reconciliation,
  drafts,
  onChange,
  rowLabel,
}: {
  reconciliation: Reconciliation;
  drafts: Record<string, ResolutionDraft>;
  onChange: (clientRowKey: string, draft: ResolutionDraft) => void;
  /** How the investor finds the row: a file line number, or a form row number. */
  rowLabel: (clientRowKey: string) => number;
}) {
  const manual = reconciliation.mode === "manual_entry";
  const flagged = reconciliation.rows.filter((r) => r.requiresResolution);
  const willInsert = reconciliation.counts.new + flagged.filter((r) => drafts[r.clientRowKey]?.action === "separate").length;
  const unresolved = unresolvedCount(reconciliation, drafts);
  if (manual && reconciliation.counts.exact_duplicate === 0 && flagged.length === 0) return null;

  return (
    <Section id={`reconciliation-${reconciliation.mode}`} title={rc.heading} hint={manual ? rc.manualExplanation : rc.explanation}>
      <KeyValues
        items={[
          { label: rc.newCount, value: <Num>{reconciliation.counts.new}</Num> },
          { label: rc.exactCount, value: <Num>{reconciliation.counts.exact_duplicate}</Num> },
          { label: rc.probableCount, value: <Num>{reconciliation.counts.probable_manual_match}</Num> },
          { label: rc.ambiguousCount, value: <Num>{reconciliation.counts.ambiguous}</Num> },
        ]}
      />
      <p className="text-sm text-ink-2">
        {rc.willInsertPrefix} <Num>{willInsert}</Num> {rc.willInsertSuffix}
      </p>
      {unresolved > 0 && <Notice tone="caution">{rc.unresolvedNote}</Notice>}
      {flagged.length > 0 && (
        <List label={rc.decisionsTitle}>
          {flagged.map((row) => (
            <DecisionRow key={row.clientRowKey} row={row} manual={manual} draft={drafts[row.clientRowKey]} onChange={onChange} line={rowLabel(row.clientRowKey)} />
          ))}
        </List>
      )}
    </Section>
  );
}

function DecisionRow({
  row,
  manual,
  draft,
  onChange,
  line,
}: {
  row: ReconciliationRow;
  manual: boolean;
  draft: ResolutionDraft | undefined;
  onChange: (clientRowKey: string, draft: ResolutionDraft) => void;
  line: number;
}) {
  const exact = row.class === "exact_duplicate";
  const name = `rc-${manual ? "manual" : "csv"}-${row.clientRowKey}`;
  const note = exact ? (row.withinBatch ? rc.exactWithinBatchNote : rc.exactRowNote) : row.class === "ambiguous" ? rc.ambiguousRowNote : rc.probableRowNote;
  const source = (s: string) => (s === "manual_entry" ? rc.manualSource : rc.csvSource);
  return (
    <ListRow>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink">
          {rc.rowPrefix} <Num>{line}</Num>: <Num>{rowFacts(row.incoming)}</Num>
        </legend>
        <p className="text-xs text-ink-2">{note}</p>
        {row.class === "probable_manual_match" && row.candidates[0] && (
          <p className="text-xs text-ink-2">
            {rc.candidateLabel}: <Num>{rowFacts(row.candidates[0])}</Num> · {source(row.candidates[0].source)}
          </p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            className="mt-1"
            checked={draft?.action === "same"}
            onChange={() => onChange(row.clientRowKey, { action: "same", existingTransactionId: row.class === "probable_manual_match" ? row.candidates[0]?.id : draft?.existingTransactionId })}
          />
          {manual ? rc.manualSameChoice : rc.sameChoice}
        </label>
        {row.class === "ambiguous" && draft?.action === "same" && (
          <Select aria-label={rc.chooseCandidate} value={draft.existingTransactionId ?? ""} onChange={(e) => onChange(row.clientRowKey, { action: "same", existingTransactionId: e.target.value || undefined })}>
            <option value="">{rc.chooseCandidate}</option>
            {row.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {rowFacts(c)} · {source(c.source)}
              </option>
            ))}
          </Select>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name={name} className="mt-1" checked={draft?.action === "separate"} onChange={() => onChange(row.clientRowKey, { action: "separate" })} />
          {manual || exact ? rc.manualSeparateChoice : rc.separateChoice}
        </label>
      </fieldset>
    </ListRow>
  );
}

export function OrderingSection({
  groups,
  orders,
  onOrder,
  describe,
  rowLabel,
}: {
  groups: ReturnType<typeof orderingGroups>;
  orders: Record<string, string>;
  onOrder: (clientRowKey: string, value: string) => void;
  describe: (clientRowKey: string) => string;
  rowLabel: (clientRowKey: string) => number;
}) {
  if (groups.length === 0) return null;
  return (
    <Section id="ordering" title={cr.heading} hint={cr.explanation}>
      <List label={cr.heading}>
        {groups.map(({ group, keys, kind }) => (
          <ListRow key={`${group.ticker}-${new Date(group.transactionDate).getTime()}`}>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-ink">
                <Num>{group.ticker}</Num> · <Num>{day(group.transactionDate)}</Num>
              </p>
              {group.existing.map((ex) => (
                <p key={ex.id} className="text-xs text-ink-2">
                  {cr.existingRow}
                </p>
              ))}
              {kind === "declarable" ? (
                <>
                  <HelpText>{cr.declareHint}</HelpText>
                  {keys.map((k) => (
                    <label key={k} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-ink-2">
                        {rc.rowPrefix} <Num>{rowLabel(k)}</Num>: <Num>{describe(k)}</Num>
                      </span>
                      <span className="w-20">
                        <Input type="number" inputMode="numeric" aria-label={`${cr.orderLabel} ${rowLabel(k)}`} value={orders[k] ?? ""} onChange={(e) => onOrder(k, e.target.value)} />
                      </span>
                    </label>
                  ))}
                </>
              ) : (
                <>
                  {keys.map((k) => (
                    <p key={k} className="text-xs text-ink-2">
                      {rc.rowPrefix} <Num>{rowLabel(k)}</Num>: <Num>{describe(k)}</Num>
                    </p>
                  ))}
                  <Notice tone={kind === "existing_ordered" ? "caution" : "neutral"}>{kind === "existing_ordered" ? cr.existingOrderedNote : cr.existingNote}</Notice>
                </>
              )}
            </div>
          </ListRow>
        ))}
      </List>
    </Section>
  );
}
