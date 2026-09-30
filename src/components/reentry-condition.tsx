"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/status";
import { HelpText } from "@/components/ui/states";
import { reentryCondition as t } from "@/lib/i18n/strings";

// Decision Follow-Through V1 — the re-entry condition lifecycle on the
// decision page. A pending condition is resolved by the investor (their own
// judgment, a required note, no market check); a CONFIRMED one offers the
// product's next step: a new Case for the same ticker with this condition as
// its explicit origin. Forecasts get no controls — they are resolved in a
// Decision Review.
// Frontend V1 unit 4: presentation only. The page owns the two mutations
// (predictions.resolveReentryCondition, cases.createFromCondition) with the
// same inputs as before; the resolved state itself is shown by the
// predictions region, so this renders only the controls.
export type ConditionStatus = "confirmed" | "refuted" | "inconclusive";

export interface ConditionActions {
  resolve: { run: (predictionId: string, status: ConditionStatus, note: string) => void; pending: boolean; error: string | null };
  openCase: { run: (predictionId: string) => void; pending: boolean; error: string | null };
}

export function ReentryConditionControls({
  prediction,
  actions,
  reconsiderationCaseId,
}: {
  prediction: { id: string; kind: string | null; status: string };
  actions: ConditionActions;
  /** The case already opened from this condition, if any (cases.list, originPredictionId). */
  reconsiderationCaseId: string | null;
}) {
  const [status, setStatus] = useState<ConditionStatus | null>(null);
  const [note, setNote] = useState("");

  if (prediction.kind !== "reentry_condition") return null;

  if (prediction.status === "confirmed") {
    return reconsiderationCaseId ? (
      <ButtonLink href={`/cases/${reconsiderationCaseId}`} size="sm" variant="secondary" className="w-fit">
        {t.openReconsiderationCase}
      </ButtonLink>
    ) : (
      <div className="flex flex-col items-start gap-2">
        <Button size="sm" variant="secondary" onClick={() => actions.openCase.run(prediction.id)} loading={actions.openCase.pending} loadingLabel={t.reconsiderOpening}>
          {t.reconsiderButton}
        </Button>
        {actions.openCase.error && <ErrorLine message={actions.openCase.error} />}
      </div>
    );
  }
  if (prediction.status !== "pending") return null;

  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
      <HelpText>{t.resolvePrompt}</HelpText>
      <div role="radiogroup" aria-label={t.resolvePrompt} className="flex flex-wrap gap-2">
        {(
          [
            ["confirmed", t.fired],
            ["refuted", t.notFired],
            ["inconclusive", t.undetermined],
          ] as const
        ).map(([value, label]) => (
          <Button key={value} size="sm" variant={status === value ? "primary" : "secondary"} aria-pressed={status === value} onClick={() => setStatus(value)}>
            {label}
          </Button>
        ))}
      </div>
      <Field label={t.notePlaceholder}>
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <Button
        size="sm"
        variant="secondary"
        className="w-fit"
        onClick={() => actions.resolve.run(prediction.id, status!, note.trim())}
        disabled={status === null || note.trim() === ""}
        loading={actions.resolve.pending}
        loadingLabel={t.submittingButton}
      >
        {t.submitButton}
      </Button>
      {actions.resolve.error && <ErrorLine message={actions.resolve.error} />}
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <Notice tone="negative">
      <bdi dir="ltr" className="text-xs">
        {message}
      </bdi>
    </Notice>
  );
}
