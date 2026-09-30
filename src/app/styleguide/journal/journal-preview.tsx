"use client";

import { JournalView } from "@/components/journal/journal-view";
import { journalPreviewData, journalPreviewSession, type JournalPreviewState } from "../journal-preview-data";

// The actions never call a procedure: opening the writer returns the synthetic
// question for that row, and saving never resolves, so the pending state stays visible.
export function JournalPreview({ state }: { state: JournalPreviewState }) {
  return (
    <JournalView
      journal={journalPreviewData(state)}
      actions={{
        start: async (transactionId) => journalPreviewSession(transactionId),
        save: () => new Promise<void>(() => undefined),
      }}
    />
  );
}
