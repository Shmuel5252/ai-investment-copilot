import { notFound } from "next/navigation";
import { DecisionPreview } from "./decision-preview";
import { DECISION_PREVIEW_STATES } from "../decision-preview-data";

// DEVELOPMENT ONLY. The Decision record rendered by its production components
// on SYNTHETIC data (decision-preview-data.ts), for design review without the
// investor's real records. ?state=fresh|reviewed|legacy|backdated|pass. Not in
// the navigation; a 404 in production.
export default async function DecisionPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = (await searchParams).state;
  const state = DECISION_PREVIEW_STATES.find((s) => s === requested) ?? "reviewed";
  return (
    <main>
      <DecisionPreview state={state} />
    </main>
  );
}
