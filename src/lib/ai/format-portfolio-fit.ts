// Single source of truth for rendering a PortfolioFit's cash/sector/
// industry exposure numbers into AI-prompt text — used by
// src/lib/ai/case.ts (Case Synthesis's formatPortfolioFit AND Personal
// Fit's formatPersonalFitContext) and src/lib/ai/decision.ts's
// formatContext, so the three don't each invent their own
// representation of the same concept (docs/backlog.md, Sector/Industry
// Exposure; CLAUDE.md Engineering Principles — same class of bug as
// computeAmountFromQuantityPrice/formatSizeDollarsLine already fixed
// elsewhere: one canonical implementation, not several).
//
// Granular (three small functions, not one that always needs a full
// PortfolioFit) on purpose: Personal Fit only ever gets sectorExposure/
// industryExposure (no cash, no projected — docs/backlog.md, Personal
// Fit scope), while Case/Decision use all of it. A single function
// requiring a whole PortfolioFit would force Personal Fit's caller to
// fabricate irrelevant fields just to satisfy the type.
import type { SectorExposureEntry, IndustryExposureEntry } from "@/lib/portfolio/portfolio-fit";

function formatBreakdown(entries: { label: string | null; weightPercent: number }[]): string {
  if (entries.length === 0) return "none";
  return entries.map((e) => `${e.label ?? "Unclassified"} ${e.weightPercent.toFixed(1)}%`).join(", ");
}

export function formatCashLine(prefix: string, cashValueUsd: number, cashWeightPercent: number): string {
  return `${prefix} cash: $${cashValueUsd.toFixed(2)} (${cashWeightPercent.toFixed(1)}% of portfolio)`;
}

export function formatSectorExposureLine(prefix: string, entries: SectorExposureEntry[]): string {
  return `${prefix} sector exposure: ${formatBreakdown(entries.map((e) => ({ label: e.sector, weightPercent: e.weightPercent })))}`;
}

export function formatIndustryExposureLine(prefix: string, entries: IndustryExposureEntry[]): string {
  return `${prefix} industry exposure: ${formatBreakdown(entries.map((e) => ({ label: e.industry, weightPercent: e.weightPercent })))}`;
}
