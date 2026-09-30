"use client";

import Link from "next/link";
import { Num } from "@/components/num";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Status, Notice } from "@/components/ui/status";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { HelpText } from "@/components/ui/states";
import { caseDetailPage as t, decisionTypeLabel } from "@/lib/i18n/strings";
import { ActionError } from "@/components/ui/action-error";
import { day } from "./parts";
import type { InventoryKey, Readiness, RuleState } from "./derive-readiness";
import type { CaseAction, ExistingDecision, RecordInput } from "./types";

// H and I: what the system requires before recording, and the recording
// itself. The form is the existing decisions.create workflow, restyled only:
// same inputs, same explicit review-horizon choice, same submit test.

const RULE_TONE: Record<RuleState, "positive" | "caution" | "neutral"> = { met: "positive", unmet: "caution", unknown: "neutral" };
const RULE_LABEL: Record<RuleState, string> = { met: t.ruleMet, unmet: t.ruleUnmet, unknown: t.ruleUnknown };

export function ReadinessRegion({ readiness, inventoryAction }: { readiness: Readiness; inventoryAction: (key: InventoryKey) => React.ReactNode }) {
  const undone = readiness.inventory.filter((i) => !i.done);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card padding="sm">
        <h3 className="mb-2 text-sm font-semibold text-ink">{t.rulesTitle}</h3>
        <ul className="flex flex-col divide-y divide-rule text-sm">
          {readiness.rules.map((r) => (
            <li key={r.key} className="flex flex-col gap-1 py-2 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink">{t.rule[r.key]}</span>
                <Status tone={RULE_TONE[r.state]}>{RULE_LABEL[r.state]}</Status>
              </div>
              {r.key === "strategy" && r.state === "unmet" && (
                <p className="text-xs text-muted">
                  {t.ruleStrategyMissingHint}{" "}
                  <Link href="/strategy" className="text-accent underline">
                    {t.openStrategy}
                  </Link>
                </p>
              )}
            </li>
          ))}
          <li className="pt-2">
            <HelpText>{t.freshAtRecord}</HelpText>
          </li>
        </ul>
      </Card>
      <Card padding="sm">
        <h3 className="mb-2 text-sm font-semibold text-ink">{t.inventoryTitle}</h3>
        {undone.length === 0 ? (
          <p className="text-sm text-ink-2">{t.inventoryAllDone}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule text-sm">
            {readiness.inventory.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0">
                <span className="flex items-center gap-3">
                  <span className="text-ink">{t.inventory[i.key]}</span>
                  <Status tone={i.done ? "info" : "neutral"}>{i.done ? t.inventoryDone : t.inventoryNotDone}</Status>
                </span>
                {!i.done && inventoryAction(i.key)}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <HelpText className="md:col-span-2">{t.readinessHint}</HelpText>
    </div>
  );
}

export const DECISION_TYPES = ["BUY", "ADD", "HOLD", "REDUCE", "SELL", "PASS"] as const;

export interface DecisionFormState {
  decisionType: (typeof DECISION_TYPES)[number];
  sizeInput: string;
  reasoningText: string;
  risksConsideredText: string;
  exitConditionsText: string;
  reviewHorizon: "" | "date" | "none";
  reviewByDate: string;
}

export function DecisionForm({
  form,
  setForm,
  formComplete,
  record,
}: {
  form: DecisionFormState;
  setForm: (patch: Partial<DecisionFormState>) => void;
  formComplete: boolean;
  record: CaseAction<[input: RecordInput]>;
}) {
  const parsedSize = form.sizeInput.trim() === "" ? undefined : Number(form.sizeInput);
  const submit = () =>
    record.run({
      decisionType: form.decisionType,
      sizeDollars: parsedSize,
      reasoningText: form.reasoningText,
      risksConsideredText: form.risksConsideredText.trim() || undefined,
      exitConditionsText: form.exitConditionsText.trim() || undefined,
      reviewHorizon: form.reviewHorizon === "date" ? { choice: "date", reviewByDate: new Date(form.reviewByDate) } : { choice: "none" },
    });

  return (
    <Card>
      {/* Not a <form>: pressing Enter in a field must never record an irreversible decision. */}
      <div className="flex flex-col gap-5">
        <Notice tone="info">{t.freezeDescription}</Notice>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.decisionTypeLabel}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={form.decisionType} onChange={(e) => setForm({ decisionType: e.target.value as DecisionFormState["decisionType"] })}>
                {DECISION_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {decisionTypeLabel[dt] ?? dt}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t.sizeLabel} help={t.sizeHelp}>
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} dir="ltr" inputMode="decimal" value={form.sizeInput} onChange={(e) => setForm({ sizeInput: e.target.value })} />}
          </Field>
        </div>
        <Field label={t.reasoningLabel} help={t.reasoningHint} required>
          {({ id, describedBy }) => (
            <Textarea id={id} aria-describedby={describedBy} className="min-h-32" value={form.reasoningText} placeholder={t.reasoningPlaceholder} onChange={(e) => setForm({ reasoningText: e.target.value })} />
          )}
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.risksLabel} help={t.optionalHelp}>
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} value={form.risksConsideredText} onChange={(e) => setForm({ risksConsideredText: e.target.value })} />}
          </Field>
          <Field label={t.exitConditionsLabel} help={t.optionalHelp}>
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} value={form.exitConditionsText} onChange={(e) => setForm({ exitConditionsText: e.target.value })} />}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2 rounded-md border border-rule px-4 pb-3 pt-2 text-sm">
          <legend className="px-1 font-medium text-ink">
            {t.reviewHorizonLabel}
            <span aria-hidden="true" className="text-negative">
              {" "}
              *
            </span>
          </legend>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="review-horizon" checked={form.reviewHorizon === "date"} onChange={() => setForm({ reviewHorizon: "date" })} />
            {t.reviewHorizonDateOption}
            <Input
              type="date"
              aria-label={t.reviewHorizonDateAria}
              className="max-w-44"
              value={form.reviewByDate}
              onChange={(e) => setForm({ reviewByDate: e.target.value, reviewHorizon: "date" })}
            />
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="review-horizon" checked={form.reviewHorizon === "none"} onChange={() => setForm({ reviewHorizon: "none" })} />
            {t.reviewHorizonNoneOption}
          </label>
          {form.reviewHorizon === "" && <p className="text-xs text-muted">{t.reviewHorizonRequired}</p>}
        </fieldset>
        <div className="flex flex-col items-start gap-2 border-t border-rule pt-4">
          <Button variant="primary" onClick={submit} disabled={!formComplete} loading={record.pending} loadingLabel={t.recordingPending}>
            {t.recordPrefix} {decisionTypeLabel[form.decisionType] ?? form.decisionType} {t.recordSuffix}
          </Button>
          <ActionError message={record.error} title={t.recordFailed} />
        </div>
      </div>
    </Card>
  );
}

export function DecidedNotice({ decision }: { decision: ExistingDecision }) {
  return (
    <Notice tone="info" title={<>{t.decidedPrefix}<Num>{day(decision.decisionDate)}</Num> · {decisionTypeLabel[decision.decisionType] ?? decision.decisionType}</>}>
      <p>{t.decidedFrozenNote}</p>
      <ButtonLink href={`/decisions/${decision.id}`} size="sm" variant="secondary" className="mt-2">
        {t.openDecision}
      </ButtonLink>
    </Notice>
  );
}
