"use client";

import { DecisionView } from "@/components/decision/decision-view";
import type { DecisionAction } from "@/components/decision/types";
import { decisionPreviewData, type DecisionPreviewState } from "../decision-preview-data";

// The actions do nothing: the preview never calls a procedure.
const idle = <A extends unknown[]>(): DecisionAction<A> => ({ run: async () => false, pending: false, error: null });
const noop = { run: () => undefined, pending: false, error: null };

export function DecisionPreview({ state }: { state: DecisionPreviewState }) {
  return (
    <DecisionView
      data={decisionPreviewData(state)}
      actions={{
        setReviewDate: idle(),
        addLaterContext: idle(),
        runReview: idle(),
        disagree: idle(),
        markExecution: noop,
        conditions: { resolve: noop, openCase: noop },
      }}
    />
  );
}
