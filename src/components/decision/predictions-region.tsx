"use client";

import { Num } from "@/components/num";
import { List, ListRow } from "@/components/ui/list";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Quote } from "@/components/ui/quote";
import { ReentryConditionControls, type ConditionActions } from "@/components/reentry-condition";
import { decisionPage as t, predictionKindLabel, predictionStatusLabel, reentryCondition } from "@/lib/i18n/strings";
import { day, labelOf } from "./parts";
import type { PredictionRow } from "./types";

// G — the bridge between THEN and SINCE. Every row keeps the two halves
// apart: the claim the AI extracted from the reasoning at recording (with
// its kind and check date when known), and what the investor determined
// since. A forecast is a belief; a re-entry condition is a check the
// investor set for themselves, resolved on its own and never a thesis
// score. No prediction score exists and none is shown.

// A condition's outcome is said in its own words (fired / did not fire),
// never with a forecast's "confirmed / refuted".
const CONDITION_STATUS: Record<string, string> = {
  confirmed: reentryCondition.fired,
  refuted: reentryCondition.notFired,
  inconclusive: reentryCondition.undetermined,
};

export function statusLabel(p: Pick<PredictionRow, "kind" | "status">): string {
  if (p.status === "pending") return t.stillOpen;
  return labelOf(p.kind === "reentry_condition" ? CONDITION_STATUS : predictionStatusLabel, p.status);
}

export function PredictionsRegion({
  predictions,
  conditionActions,
  reconsiderationCases,
}: {
  predictions: PredictionRow[];
  conditionActions: ConditionActions;
  reconsiderationCases: { id: string; originPredictionId: string }[];
}) {
  if (predictions.length === 0) return <EmptyState title={t.predictionsEmpty} />;
  const caseFor = (id: string) => reconsiderationCases.find((c) => c.originPredictionId === id)?.id ?? null;
  return (
    <List label={t.predictionsTitle}>
      {predictions.map((p) => (
        <ListRow key={p.id}>
          <div className="grid gap-4 md:grid-cols-2 md:gap-8">
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-muted">{t.thenColumn}</p>
              {p.kind && (
                <Badge tone="neutral" className="w-fit">
                  {predictionKindLabel[p.kind] ?? "—"}
                </Badge>
              )}
              <p className="text-sm text-ink">{p.claimText}</p>
              <p className="text-xs text-muted">
                {p.checkableByDate ? (
                  <>
                    {t.checkableByPrefix} <Num>{day(p.checkableByDate)}</Num>
                  </>
                ) : (
                  t.noCheckDate
                )}
              </p>
            </div>
            <div className="flex flex-col gap-1.5 md:border-s md:border-rule md:ps-8">
              <p className="text-xs font-semibold text-muted">{t.sinceColumn}</p>
              <p className="text-sm font-medium text-ink">{statusLabel(p)}</p>
              {p.resolutionNote && <Quote>{p.resolutionNote}</Quote>}
              {(p.resolvedAt || p.resolvedByReviewId) && (
                <p className="text-xs text-muted">
                  {p.resolvedAt && (
                    <>
                      {t.resolvedOnPrefix}
                      <Num>{day(p.resolvedAt)}</Num>
                    </>
                  )}
                  {p.resolvedAt && p.resolvedByReviewId && " · "}
                  {p.resolvedByReviewId && t.resolvedInReview}
                </p>
              )}
              <ReentryConditionControls prediction={p} actions={conditionActions} reconsiderationCaseId={caseFor(p.id)} />
            </div>
          </div>
        </ListRow>
      ))}
    </List>
  );
}
