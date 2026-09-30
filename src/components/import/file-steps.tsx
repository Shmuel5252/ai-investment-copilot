"use client";

import { Num } from "@/components/num";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { List, ListRow } from "@/components/ui/list";
import { KeyValues } from "@/components/ui/table";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Disclosure } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/status";
import { HelpText } from "@/components/ui/states";
import { ActionError } from "@/components/ui/action-error";
import { RegionBody } from "@/components/home/region";
import type { Loadable } from "@/components/home/types";
import { CANONICAL_FIELDS, type CanonicalField } from "@/lib/import/types";
import { costBasisConfidenceLabel, importFieldLabel, importPage as t } from "@/lib/i18n/strings";
import { OrderingSection, ReconciliationSection, orderingGroups, rowFacts, skippedKeys, unresolvedCount } from "./reconciliation";
import type { ImportResultView, OpeningStateDraft, PositionsView, PreviewData, ResolutionDraft, ValidationData, WriteError } from "./types";

// The file path of /import: upload, mapping, review, done. Presentational:
// the page owns the state and calls the procedures. The review is a
// preview (import.validate); confirmImport re-parses and re-checks
// everything under its locks, so nothing here is presented as final.

export type Mapping = Partial<Record<CanonicalField, string>>;
/** date and type are the two fields the page requires before checking the file, as before. */
export const mappingReady = (mapping: Mapping) => Boolean(mapping.date && mapping.type);
const csvLine = (clientRowKey: string) => Number(clientRowKey) + 1;

export function UploadStep({ onFile, reading }: { onFile: (file: File) => void; reading: boolean }) {
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">{t.uploadTitle}</h3>
      <Field label={t.uploadLabel} help={t.uploadHelp}>
        {({ id, describedBy }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            type="file"
            accept=".csv,text/csv"
            className="text-sm text-ink-2 file:me-3 file:rounded-md file:border file:border-control file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        )}
      </Field>
      {reading && <HelpText>{t.readingFile}</HelpText>}
    </Card>
  );
}

export function MappingStep({
  filename,
  preview,
  mapping,
  onMapping,
  onCheck,
  onChangeFile,
}: {
  filename: string;
  preview: Loadable<PreviewData>;
  mapping: Mapping;
  onMapping: (field: CanonicalField, header: string | undefined) => void;
  onCheck: () => void;
  onChangeFile: () => void;
}) {
  return (
    <Section id="mapping" title={t.mappingTitle} hint={t.mappingHint}>
      <RegionBody q={preview} lines={6}>
        {(p) => (
          <Card className="flex flex-col gap-4">
            <p className="text-sm text-ink-2">
              <Num>{filename}</Num> · {t.mappingRowsPrefix} <Num>{p.rowCount}</Num> {t.mappingRowsSuffix}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {CANONICAL_FIELDS.map((field) => (
                <Field key={field} label={importFieldLabel[field]} required={field === "date" || field === "type"}>
                  {({ id }) => (
                    <Select id={id} value={mapping[field] ?? ""} onChange={(e) => onMapping(field, e.target.value || undefined)}>
                      <option value="">{t.notMappedOption}</option>
                      {p.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </div>
            <HelpText>{t.mappingRequiredNote}</HelpText>
            <Disclosure summary={t.previewRowsSummary}>
              <ol className="flex flex-col gap-3">
                {p.previewRows.map((row, i) => (
                  <li key={i} className="flex flex-col gap-1">
                    <p className="text-xs font-semibold text-ink-2">
                      {t.previewRowPrefix} <Num>{i + 1}</Num>
                    </p>
                    <KeyValues className="text-xs" items={p.headers.map((h) => ({ label: <bdi>{h}</bdi>, value: <bdi>{row[h] ?? ""}</bdi> }))} />
                  </li>
                ))}
              </ol>
            </Disclosure>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={onCheck} disabled={!mappingReady(mapping)}>
                {t.checkButton}
              </Button>
              <Button variant="quiet" onClick={onChangeFile}>
                {t.changeFileButton}
              </Button>
            </div>
          </Card>
        )}
      </RegionBody>
    </Section>
  );
}

export interface ConfirmState {
  run: () => void;
  pending: boolean;
  error: WriteError | null;
  /** After a failure that may have written something, confirm waits for a refresh. */
  needsRefresh: boolean;
  refresh: () => void;
  refreshing: boolean;
}

export function ReviewStep({
  validation,
  splitsCount,
  resolutions,
  onResolution,
  orders,
  onOrder,
  openingStates,
  onOpening,
  confirm,
  onBack,
}: {
  validation: Loadable<ValidationData>;
  splitsCount: number | null;
  resolutions: Record<string, ResolutionDraft>;
  onResolution: (clientRowKey: string, draft: ResolutionDraft) => void;
  orders: Record<string, string>;
  onOrder: (clientRowKey: string, value: string) => void;
  openingStates: Record<string, OpeningStateDraft>;
  onOpening: (ticker: string, patch: Partial<OpeningStateDraft>) => void;
  confirm: ConfirmState;
  onBack: () => void;
}) {
  return (
    <Section id="review" title={t.reviewTitle} action={<Button variant="quiet" size="sm" onClick={onBack}>{t.backToMappingButton}</Button>}>
      <Notice tone="info">{t.advisoryNote}</Notice>
      <RegionBody q={validation} lines={8}>
        {(v) => <Review v={v} splitsCount={splitsCount} resolutions={resolutions} onResolution={onResolution} orders={orders} onOrder={onOrder} openingStates={openingStates} onOpening={onOpening} confirm={confirm} />}
      </RegionBody>
    </Section>
  );
}

function Review({
  v,
  splitsCount,
  resolutions,
  onResolution,
  orders,
  onOrder,
  openingStates,
  onOpening,
  confirm,
}: {
  v: ValidationData;
  splitsCount: number | null;
  resolutions: Record<string, ResolutionDraft>;
  onResolution: (clientRowKey: string, draft: ResolutionDraft) => void;
  orders: Record<string, string>;
  onOrder: (clientRowKey: string, value: string) => void;
  openingStates: Record<string, OpeningStateDraft>;
  onOpening: (ticker: string, patch: Partial<OpeningStateDraft>) => void;
  confirm: ConfirmState;
}) {
  const unresolved = unresolvedCount(v.reconciliation, resolutions);
  const groups = orderingGroups(v.collisionGroups, skippedKeys(v.reconciliation, resolutions));
  const factsByKey = new Map(v.reconciliation.rows.map((r) => [r.clientRowKey, rowFacts(r.incoming)]));
  const flagged = v.reconciliation.rows.filter((r) => r.requiresResolution);
  const willInsert = v.reconciliation.counts.new + flagged.filter((r) => resolutions[r.clientRowKey]?.action === "separate").length;
  const openingEntered = v.tickersNeedingOpeningState.some((tk) => (openingStates[tk]?.quantity ?? "").trim() !== "");
  const blockers = [v.invalidRows.length > 0 && t.blockedInvalid, unresolved > 0 && t.blockedUnresolved, confirm.needsRefresh && t.blockedRefresh].filter(Boolean) as string[];

  const summary = [
    { label: t.rowsTotal, value: <Num>{v.validCount + v.invalidRows.length}</Num> },
    { label: t.rowsValid, value: <Num>{v.validCount}</Num> },
    { label: t.rowsInvalid, value: <Num>{v.invalidRows.length}</Num> },
  ];
  if (splitsCount !== null) summary.push({ label: t.splitsConsidered, value: <Num>{splitsCount}</Num> });

  return (
    <div className="flex flex-col gap-8">
      <KeyValues items={summary} />

      {v.invalidRows.length > 0 && (
        <Section id="invalid" title={t.invalidTitle} count={v.invalidRows.length} hint={t.invalidHint}>
          <List label={t.invalidTitle}>
            {v.invalidRows.map((r) => (
              <ListRow key={r.rowIndex}>
                <p className="text-sm text-ink">
                  {t.rowLabel} <Num>{r.rowIndex + 1}</Num>
                </p>
                <p className="text-xs text-ink-2">
                  <bdi dir="ltr">{r.errors.join(", ")}</bdi>
                </p>
              </ListRow>
            ))}
          </List>
        </Section>
      )}

      <ReconciliationSection reconciliation={v.reconciliation} drafts={resolutions} onChange={onResolution} rowLabel={csvLine} />

      <OrderingSection groups={groups} orders={orders} onOrder={onOrder} describe={(k) => factsByKey.get(k) ?? ""} rowLabel={csvLine} />

      {v.tickersNeedingOpeningState.length > 0 && (
        <OpeningStates tickers={v.tickersNeedingOpeningState} drafts={openingStates} onChange={onOpening} />
      )}

      <Card className="flex flex-col gap-3">
        <h3 id="confirm" className="text-sm font-semibold text-ink">{t.confirmTitle}</h3>
        <p className="text-sm leading-relaxed text-ink-2">{t.confirmExplanation}</p>
        {openingEntered && <p className="text-sm text-ink-2">{t.confirmOpeningNote}</p>}
        <p className="text-sm text-ink-2">
          {t.estimatePrefix} <Num>{willInsert}</Num> {t.estimateSuffix}
        </p>
        {blockers.length > 0 && (
          <ul className="flex list-disc flex-col gap-0.5 ps-5 text-sm text-ink-2">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <div>
          <Button variant="primary" onClick={confirm.run} disabled={blockers.length > 0} loading={confirm.pending} loadingLabel={t.confirmingButton}>
            {t.confirmButton}
          </Button>
        </div>
        <WriteFailure error={confirm.error} refresh={confirm.refresh} refreshing={confirm.refreshing} body={t.uncertainBody} />
      </Card>
    </div>
  );
}

function OpeningStates({ tickers, drafts, onChange }: { tickers: string[]; drafts: Record<string, OpeningStateDraft>; onChange: (ticker: string, patch: Partial<OpeningStateDraft>) => void }) {
  return (
    <Section id="opening" title={t.openingTitle} count={tickers.length} hint={t.openingHint}>
      <HelpText>{t.openingSeparateNote}</HelpText>
      <List label={t.openingTitle}>
        {tickers.map((ticker) => {
          const d = drafts[ticker];
          return (
            <ListRow key={ticker}>
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-ink">
                  <Num>{ticker}</Num>
                </p>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label={t.openingQuantity}>
                    {({ id }) => <Input id={id} type="number" step="any" value={d?.quantity ?? ""} onChange={(e) => onChange(ticker, { quantity: e.target.value })} />}
                  </Field>
                  <Field label={t.openingCostBasis}>
                    {({ id }) => <Input id={id} type="number" step="any" value={d?.costBasisPerShare ?? ""} onChange={(e) => onChange(ticker, { costBasisPerShare: e.target.value })} />}
                  </Field>
                  <Field label={t.openingConfidence}>
                    {({ id }) => (
                      <Select id={id} value={d?.costBasisConfidence ?? "approximate"} onChange={(e) => onChange(ticker, { costBasisConfidence: e.target.value as OpeningStateDraft["costBasisConfidence"] })}>
                        <option value="known">{costBasisConfidenceLabel.known}</option>
                        <option value="approximate">{costBasisConfidenceLabel.approximate}</option>
                        <option value="unknown">{costBasisConfidenceLabel.unknown}</option>
                      </Select>
                    )}
                  </Field>
                  <Field label={t.openingAsOf}>
                    {({ id }) => <Input id={id} type="date" value={d?.asOfDate ?? new Date().toISOString().slice(0, 10)} onChange={(e) => onChange(ticker, { asOfDate: e.target.value })} />}
                  </Field>
                </div>
              </div>
            </ListRow>
          );
        })}
      </List>
    </Section>
  );
}

/**
 * A failed write, said as precisely as the contract allows: a refusal wrote
 * nothing; any other failure may have written part of the request, so the
 * investor is asked to refresh and look before trying again.
 */
export function WriteFailure({ error, refresh, refreshing, body }: { error: WriteError | null; refresh?: () => void; refreshing?: boolean; body: string }) {
  if (!error) return null;
  if (error.refused) return <ActionError title={t.refusedTitle} message={error.message} />;
  return (
    <Notice tone="caution" title={t.uncertainTitle}>
      <div className="flex flex-col items-start gap-2">
        <p>{body}</p>
        <p className="text-xs">
          <bdi dir="ltr">{error.message}</bdi>
        </p>
        {refresh && (
          <Button size="sm" variant="secondary" onClick={refresh} loading={refreshing} loadingLabel={t.refreshingButton}>
            {t.refreshButton}
          </Button>
        )}
      </div>
    </Notice>
  );
}

export function DoneStep({ result, filename, openingSaved, onAnother }: { result: ImportResultView; filename: string; openingSaved: number; onAnother: () => void }) {
  const items = [{ label: t.doneImported, value: <Num>{result.importedCount}</Num> }];
  if (result.separateCount > 0) items.push({ label: t.doneSeparate, value: <Num>{result.separateCount}</Num> });
  if (result.skippedExactCount > 0) items.push({ label: t.doneSkippedExact, value: <Num>{result.skippedExactCount}</Num> });
  if (result.skippedSameCount > 0) items.push({ label: t.doneSkippedSame, value: <Num>{result.skippedSameCount}</Num> });
  items.push({ label: t.doneFile, value: <Num>{filename}</Num> });
  return (
    <Section id="done" title={t.doneTitle}>
      <Card className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">{t.doneTransactionsTitle}</h3>
        <KeyValues items={items} />
      </Card>
      <Card className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">{t.doneOpeningTitle}</h3>
        {openingSaved > 0 ? (
          <p className="text-sm text-ink-2">
            <Num>{openingSaved}</Num> {t.doneOpeningSaved}
          </p>
        ) : (
          <p className="text-sm text-ink-2">{t.doneOpeningNone}</p>
        )}
      </Card>
      <Positions positions={result.positions} />
      {result.importedCount > 0 && <JournalNext text={t.journalNext} />}
      <div>
        <Button variant="secondary" onClick={onAnother}>
          {t.importAnotherButton}
        </Button>
      </div>
    </Section>
  );
}

export function Positions({ positions }: { positions: PositionsView }) {
  return (
    <Disclosure summary={t.positionsSummary}>
      {positions.positions.length === 0 ? (
        <p className="text-sm text-ink-2">{t.noPositions}</p>
      ) : (
        <List label={t.positionsSummary}>
          {positions.positions.map((p) => (
            <ListRow key={p.ticker}>
              <p className="text-sm text-ink">
                <Num>{p.ticker}</Num> · <Num>{p.quantity}</Num>
              </p>
              <p className="text-xs text-ink-2">
                {t.positionsAvgCost} <Num>{p.costBasisPerShare === null ? "—" : `$${p.costBasisPerShare.toFixed(2)}`}</Num> · {costBasisConfidenceLabel[p.costBasisConfidence] ?? p.costBasisConfidence}
              </p>
            </ListRow>
          ))}
        </List>
      )}
      <p className="text-sm text-ink-2">
        {t.positionsCash}: <Num>${positions.cash.toFixed(2)}</Num>
      </p>
    </Disclosure>
  );
}

export function JournalNext({ text }: { text: string }) {
  return (
    <Notice tone="neutral">
      <div className="flex flex-col items-start gap-2">
        <p>{text}</p>
        <ButtonLink href="/journal" size="sm" variant="secondary">
          {t.journalLink}
        </ButtonLink>
      </div>
    </Notice>
  );
}
