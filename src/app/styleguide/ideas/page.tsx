import { notFound } from "next/navigation";
import { IdeasPreview } from "./ideas-preview";
import { IDEAS_PREVIEW_STATES } from "../ideas-preview-data";

// DEVELOPMENT ONLY. The Ideas notebook rendered by its production components
// on SYNTHETIC data (ideas-preview-data.ts). ?state=mixed|empty|promoted.
// Not in the navigation; a 404 in production.
export default async function IdeasPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = (await searchParams).state;
  const state = IDEAS_PREVIEW_STATES.find((s) => s === requested) ?? "mixed";
  return (
    <main>
      <IdeasPreview state={state} />
    </main>
  );
}
