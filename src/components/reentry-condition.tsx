"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { reentryCondition as t } from "@/lib/i18n/strings";

// Decision Follow-Through V1 — the re-entry condition lifecycle on the
// decision page. A pending condition is resolved by the investor (their own
// judgment, a required note, no market check); a CONFIRMED one offers the
// product's next step: a new Case for the same ticker with this condition as
// its explicit origin. Forecasts get no controls — they are resolved in a
// Decision Review.
interface PredictionRow {
  id: string;
  kind: "forecast" | "reentry_condition" | null;
  status: string;
  resolutionNote: string | null;
  resolvedAt: string | Date | null;
}

type Status = "confirmed" | "refuted" | "inconclusive";

export function ReentryConditionControls({ prediction, decisionId }: { prediction: PredictionRow; decisionId: string }) {
  const router = useRouter();
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<Status | null>(null);
  const [note, setNote] = useState("");
  const resolve = trpc.predictions.resolveReentryCondition.useMutation({
    onSuccess: () => {
      utils.decisions.get.invalidate({ decisionId });
      utils.reviews.pendingPredictions.invalidate({ decisionId });
      utils.predictions.openReentryConditions.invalidate();
    },
  });
  const openCase = trpc.cases.createFromCondition.useMutation({
    onSuccess: (c) => router.push(`/cases/${c.id}`),
  });

  if (prediction.kind !== "reentry_condition") return null;

  if (prediction.status !== "pending") {
    return (
      <div className="mt-2 flex flex-col gap-1 text-xs">
        <p className="text-journal-muted">
          {t.yourCallPrefix} {prediction.status === "confirmed" ? t.fired : prediction.status === "refuted" ? t.notFired : t.undetermined}
        </p>
        {prediction.resolutionNote && (
          <p className="text-journal-ink">
            {t.resolvedNotePrefix} {prediction.resolutionNote}
          </p>
        )}
        {prediction.resolvedAt && (
          <p className="text-journal-muted">
            {t.resolvedAtPrefix}-<Num>{new Date(prediction.resolvedAt).toLocaleDateString("he-IL")}</Num>
          </p>
        )}
        {prediction.status === "confirmed" && (
          <button
            onClick={() => guard(() => openCase.mutateAsync({ predictionId: prediction.id }), `open-case-${prediction.id}`)}
            disabled={openCase.isPending}
            className="mt-1 w-fit rounded border border-journal-rule px-2 py-1 text-xs text-journal-ink hover:bg-journal-bg disabled:opacity-50"
          >
            {openCase.isPending ? t.reconsiderOpening : t.reconsiderButton}
          </button>
        )}
        {openCase.isError && <p className="text-red-600">{openCase.error.message}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded border border-journal-rule bg-journal-bg p-2 text-xs">
      <p className="text-journal-muted">{t.resolvePrompt}</p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["confirmed", t.fired],
            ["refuted", t.notFired],
            ["inconclusive", t.undetermined],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setStatus(value)}
            className={`rounded border px-2 py-1 ${status === value ? "border-journal-ink bg-journal-ink text-journal-surface" : "border-journal-rule"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t.notePlaceholder}
        className="rounded border border-journal-rule bg-journal-surface p-1"
      />
      <button
        onClick={() =>
          guard(
            () => resolve.mutateAsync({ predictionId: prediction.id, status: status!, note: note.trim() }),
            `resolve-${prediction.id}`
          )
        }
        disabled={status === null || note.trim() === "" || resolve.isPending}
        className="w-fit rounded border border-journal-rule px-2 py-1 text-journal-ink hover:bg-journal-surface disabled:opacity-50"
      >
        {resolve.isPending ? t.submittingButton : t.submitButton}
      </button>
      {resolve.isError && <p className="text-red-600">{resolve.error.message}</p>}
    </div>
  );
}
