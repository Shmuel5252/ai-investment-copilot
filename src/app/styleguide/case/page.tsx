import { notFound } from "next/navigation";
import { CasePreview } from "./case-preview";
import type { CasePreviewState } from "../case-preview-data";

// DEVELOPMENT ONLY. The Case page rendered by its production components on
// SYNTHETIC data (case-preview-data.ts), for design review without the
// investor's real figures. ?state=researched|fresh|decided. Not in the
// navigation; a 404 in production.
const STATES: readonly CasePreviewState[] = ["researched", "fresh", "decided"];

export default async function CasePreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = (await searchParams).state;
  const state = STATES.find((s) => s === requested) ?? "researched";
  return (
    <main>
      <CasePreview state={state} />
    </main>
  );
}
