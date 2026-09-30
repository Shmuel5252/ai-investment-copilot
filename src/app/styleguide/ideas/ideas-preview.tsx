"use client";

import { IdeasView } from "@/components/ideas/ideas-view";
import { ideasPreviewData, type IdeasPreviewState } from "../ideas-preview-data";

// The actions do nothing: the preview never calls a procedure.
export function IdeasPreview({ state }: { state: IdeasPreviewState }) {
  const data = ideasPreviewData(state);
  return (
    <IdeasView
      ideas={data.ideas}
      cases={data.cases}
      actions={{
        create: { run: async () => false, pending: false, error: null },
        promote: { run: () => undefined, pendingIdeaId: null, error: null },
      }}
    />
  );
}
