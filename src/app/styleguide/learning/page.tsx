import { notFound } from "next/navigation";
import { LearningPreview } from "./learning-preview";
import { LEARNING_PREVIEW_STATES } from "../learning-preview-data";

// DEVELOPMENT ONLY. Learning rendered by its production components on
// SYNTHETIC data (learning-preview-data.ts).
// ?state=main|empty|loading|error|replayed|refused|failed.
// Not in the navigation; a 404 in production.
export default async function LearningPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = (await searchParams).state;
  const state = LEARNING_PREVIEW_STATES.find((s) => s === requested) ?? "main";
  return (
    <main>
      <LearningPreview state={state} />
    </main>
  );
}
