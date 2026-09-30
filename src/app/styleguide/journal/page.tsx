import { notFound } from "next/navigation";
import { JournalPreview } from "./journal-preview";
import { JOURNAL_PREVIEW_STATES } from "../journal-preview-data";

// DEVELOPMENT ONLY. The Journal rendered by its production components on
// SYNTHETIC data (journal-preview-data.ts). ?state=main|empty|covered.
// Not in the navigation; a 404 in production.
export default async function JournalPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = (await searchParams).state;
  const state = JOURNAL_PREVIEW_STATES.find((s) => s === requested) ?? "main";
  return (
    <main>
      <JournalPreview state={state} />
    </main>
  );
}
