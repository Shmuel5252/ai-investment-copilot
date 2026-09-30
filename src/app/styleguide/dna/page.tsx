import { notFound } from "next/navigation";
import { DnaPreview } from "./dna-preview";
import { DNA_PREVIEW_STATES } from "../dna-preview-data";

// DEVELOPMENT ONLY. The DNA page rendered by its production components on
// SYNTHETIC data (dna-preview-data.ts). ?state=insufficient|mixed|empty.
// Not in the navigation; a 404 in production.
export default async function DnaPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = (await searchParams).state;
  const state = DNA_PREVIEW_STATES.find((s) => s === requested) ?? "insufficient";
  return (
    <main>
      <DnaPreview state={state} />
    </main>
  );
}
