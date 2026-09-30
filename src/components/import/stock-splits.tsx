"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { List, ListRow } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Quote } from "@/components/ui/quote";
import { EmptyState, HelpText } from "@/components/ui/states";
import { RegionBody } from "@/components/home/region";
import { day, type Loadable } from "@/components/home/types";
import { corporateActionsPage as ca } from "@/lib/i18n/strings";
import { WriteFailure } from "./file-steps";
import type { CorporateAction, SplitSource, WriteError } from "./types";

// Stock splits (Import Blockers V1): a fact the investor records from a
// named source and confirms explicitly; never detected by the system,
// immutable once recorded, one per ticker and date. Ownership, the ratio
// checks and the uniqueness are enforced by the server.

export const splitSourceLabel = (s: string) => (s === "issuer_disclosure" ? ca.sourceIssuer : s === "broker_statement" ? ca.sourceBroker : ca.sourceUser);

export interface SplitInput {
  ticker: string;
  effectiveDate: Date;
  ratioNumerator: number;
  ratioDenominator: number;
  source: SplitSource;
  evidence: string;
  confirmed: true;
}

export interface SplitActions {
  /** Resolves true when recorded, so the form clears only then. */
  record: (input: SplitInput) => Promise<boolean>;
  pending: boolean;
  error: WriteError | null;
}

const emptyDraft = () => ({ ticker: "", effectiveDate: "", numerator: "", denominator: "1", source: "issuer_disclosure" as SplitSource, evidence: "", confirmed: false });

export function StockSplits({ list, actions }: { list: Loadable<CorporateAction[]>; actions: SplitActions }) {
  const [draft, setDraft] = useState(emptyDraft());
  const numerator = Number(draft.numerator);
  const denominator = Number(draft.denominator);
  const ready =
    draft.ticker.trim() !== "" &&
    draft.effectiveDate !== "" &&
    Number.isInteger(numerator) &&
    numerator > 0 &&
    Number.isInteger(denominator) &&
    denominator > 0 &&
    numerator !== denominator &&
    draft.evidence.trim() !== "" &&
    draft.confirmed;

  return (
    <Section id="splits" title={ca.title} hint={ca.description}>
      <h3 className="text-sm font-semibold text-ink">{ca.listTitle}</h3>
      <RegionBody q={list} lines={2}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title={ca.none} />
          ) : (
            <List label={ca.listTitle}>
              {rows.map((a) => (
                <ListRow key={a.id}>
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm text-ink">
                      <Num>{a.ticker}</Num> · <Num>{`${a.ratioNumerator}:${a.ratioDenominator}`}</Num> · {ca.effectiveDateLabel} <Num>{day(a.effectiveDate)}</Num>
                    </p>
                    <p className="text-xs text-ink-2">
                      {ca.sourceLabel}: {splitSourceLabel(a.source)}
                    </p>
                    <Quote>{a.evidence}</Quote>
                    <p className="text-xs text-muted">
                      {ca.recordedOnPrefix}
                      <Num>{day(a.createdAt)}</Num>
                    </p>
                  </div>
                </ListRow>
              ))}
            </List>
          )
        }
      </RegionBody>

      <Card className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-ink">{ca.formTitle}</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={ca.tickerLabel} required>
            {({ id }) => <Input id={id} dir="ltr" value={draft.ticker} onChange={(e) => setDraft({ ...draft, ticker: e.target.value })} />}
          </Field>
          <Field label={ca.effectiveDateLabel} help={ca.effectiveDateHint} required>
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="date" value={draft.effectiveDate} onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })} />}
          </Field>
          <Field label={ca.ratioNumerator} required>
            {({ id }) => <Input id={id} type="number" min={1} step={1} value={draft.numerator} onChange={(e) => setDraft({ ...draft, numerator: e.target.value })} />}
          </Field>
          <Field label={ca.ratioDenominator} required>
            {({ id }) => <Input id={id} type="number" min={1} step={1} value={draft.denominator} onChange={(e) => setDraft({ ...draft, denominator: e.target.value })} />}
          </Field>
        </div>
        <HelpText>{ca.ratioHint}</HelpText>
        <Field label={ca.sourceLabel} required>
          {({ id }) => (
            <Select id={id} className="sm:max-w-80" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as SplitSource })}>
              <option value="issuer_disclosure">{ca.sourceIssuer}</option>
              <option value="broker_statement">{ca.sourceBroker}</option>
              <option value="user_declared">{ca.sourceUser}</option>
            </Select>
          )}
        </Field>
        <Field label={ca.evidenceLabel} required>
          {({ id }) => <Textarea id={id} rows={3} placeholder={ca.evidencePlaceholder} value={draft.evidence} onChange={(e) => setDraft({ ...draft, evidence: e.target.value })} />}
        </Field>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-1" checked={draft.confirmed} onChange={(e) => setDraft({ ...draft, confirmed: e.target.checked })} />
          {ca.confirmLabel}
        </label>
        <HelpText>{ca.uniqueNote}</HelpText>
        <div>
          <Button
            variant="primary"
            disabled={!ready}
            loading={actions.pending}
            loadingLabel={ca.recordingButton}
            onClick={async () => {
              const ok = await actions.record({
                ticker: draft.ticker.trim(),
                effectiveDate: new Date(draft.effectiveDate),
                ratioNumerator: numerator,
                ratioDenominator: denominator,
                source: draft.source,
                evidence: draft.evidence.trim(),
                confirmed: true,
              });
              if (ok) setDraft(emptyDraft());
            }}
          >
            {ca.recordButton}
          </Button>
        </div>
        <WriteFailure error={actions.error} body={ca.uncertainBody} />
      </Card>
    </Section>
  );
}
