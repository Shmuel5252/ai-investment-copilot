import { notFound } from "next/navigation";
import { InterviewPreview } from "./interview-preview";
import { INTERVIEW_PREVIEW_STATES } from "../interview-preview-data";

// DEVELOPMENT ONLY. The guided interview rendered by its production
// components on SYNTHETIC data (interview-preview-data.ts).
// ?state=orientation|no-history|no-eligible|start-failed|active|restart|long|complete-failed.
// Not in the navigation; a 404 in production.
export default async function InterviewPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = (await searchParams).state;
  const state = INTERVIEW_PREVIEW_STATES.find((s) => s === requested) ?? "orientation";
  return (
    <main>
      <InterviewPreview state={state} />
    </main>
  );
}
