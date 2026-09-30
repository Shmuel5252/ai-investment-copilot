"use client";

import { CaseView } from "@/components/case/case-view";
import type { CaseAction } from "@/components/case/types";
import { casePreviewData, type CasePreviewState } from "../case-preview-data";

// The actions do nothing: the preview never calls a procedure.
const idle = <A extends unknown[]>(): CaseAction<A> => ({ run: () => undefined, pending: false, error: null });

export function CasePreview({ state }: { state: CasePreviewState }) {
  return (
    <CaseView
      data={casePreviewData(state)}
      actions={{ fetchMarket: idle(), computeFit: idle(), personalFit: idle(), reading: idle(), record: idle() }}
      initialForm={state === "researched" ? { sizeInput: "3000" } : undefined}
    />
  );
}
