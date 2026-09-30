import { notFound } from "next/navigation";
import { ImportPreview } from "./import-preview";
import { IMPORT_PREVIEW_STATES } from "../import-preview-data";

// DEVELOPMENT ONLY. The Import page rendered by its production components on
// SYNTHETIC data (import-preview-data.ts).
// ?state=start|first|mapping|review|partial|done|manual|manual-done.
// Not in the navigation; a 404 in production.
export default async function ImportPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = (await searchParams).state;
  const state = IMPORT_PREVIEW_STATES.find((s) => s === requested) ?? "start";
  return (
    <main>
      <ImportPreview state={state} />
    </main>
  );
}
