"use client";

import { useState } from "react";
import { loaded } from "@/components/home/types";
import { LearningEvidence, LearningView } from "@/components/learning/learning-view";
import { learningPreviewActions, learningPreviewInsights, PREVIEW_EVIDENCE, PREVIEW_GENERATE_RESULT, type LearningPreviewState } from "../learning-preview-data";

// The production components on synthetic data: no procedure, no AI. "Generate"
// shows a fixed synthetic result; respond flows are reached by clicking.
export function LearningPreview({ state }: { state: LearningPreviewState }) {
  const [result, setResult] = useState<typeof PREVIEW_GENERATE_RESULT | null>(null);
  const generate = { run: () => setResult(PREVIEW_GENERATE_RESULT), pending: false, error: state === "failed" ? "Sample generation failure" : null, result };
  return (
    <LearningView
      insights={learningPreviewInsights(state)}
      actions={learningPreviewActions(state, generate)}
      renderEvidence={(id, version) => <LearningEvidence version={version} evidence={loaded(PREVIEW_EVIDENCE[id] ?? [])} />}
    />
  );
}
