import { notFound } from "next/navigation";
import { StrategyPreview } from "./strategy-preview";
import { STRATEGY_PREVIEW_STATES } from "../strategy-preview-data";

// DEVELOPMENT ONLY. The Strategy page rendered by its production components
// on SYNTHETIC data (strategy-preview-data.ts). ?state=main|flow|sparse.
// Not in the navigation; a 404 in production.
export default async function StrategyPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = (await searchParams).state;
  const state = STRATEGY_PREVIEW_STATES.find((s) => s === requested) ?? "main";
  return (
    <main>
      <StrategyPreview state={state} />
    </main>
  );
}
