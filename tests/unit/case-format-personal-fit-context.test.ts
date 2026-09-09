import { describe, expect, it } from "vitest";
import { formatPersonalFitContext } from "@/lib/ai/case";
import type { PersonalFitInput } from "@/lib/ai/case";

// Regression for a real pre-commit blocker (external review of the
// Sector/Industry Exposure handoff, docs/backlog.md): Personal Fit's
// context included the portfolio's current sector/industry exposure but
// never the CANDIDATE's own sector/industry — so connecting "this idea
// is in a sector the portfolio is already concentrated in" would have
// required the model to classify the ticker itself, exactly the
// AI-classification non-goal this whole feature exists to avoid.
//
// formatPersonalFitContext is now exported specifically so it can be
// tested directly like this — same pattern as decision.ts's
// formatContext (tests/unit/decision-format-context.test.ts), not new
// test infrastructure.
const fixture: PersonalFitInput = {
  ticker: "SNDK",
  candidateSector: "Technology",
  candidateIndustry: "Semiconductors",
  dnaHypotheses: [],
  strategyPrinciples: [],
  sectorExposure: [
    { sector: "Technology", valueUsd: 18000, weightPercent: 45 },
    { sector: "Healthcare", valueUsd: 8000, weightPercent: 20 },
    { sector: "Energy", valueUsd: 4000, weightPercent: 10 },
  ],
  industryExposure: [{ industry: "Semiconductors", valueUsd: 6000, weightPercent: 15 }],
};

describe("formatPersonalFitContext", () => {
  it("states the candidate's own sector explicitly, as a plain fact — not left for the model to infer from the ticker", () => {
    expect(formatPersonalFitContext(fixture)).toContain("Candidate sector: Technology");
  });

  it("states the candidate's own industry explicitly", () => {
    expect(formatPersonalFitContext(fixture)).toContain("Candidate industry: Semiconductors");
  });

  it("shows a null candidate sector as 'Unclassified', not omitted", () => {
    const noSector: PersonalFitInput = { ...fixture, candidateSector: null };
    expect(formatPersonalFitContext(noSector)).toContain("Candidate sector: Unclassified");
  });

  it("shows a null candidate industry as 'Unclassified', not omitted", () => {
    const noIndustry: PersonalFitInput = { ...fixture, candidateIndustry: null };
    expect(formatPersonalFitContext(noIndustry)).toContain("Candidate industry: Unclassified");
  });

  it("presents the candidate's classification together with the portfolio's current sector/industry exposure — the model can connect them without classifying anything itself", () => {
    const output = formatPersonalFitContext(fixture);
    // Both facts are present, plainly, in the same context — the model
    // isn't asked to infer SNDK's sector from general knowledge to see
    // that it lands in the portfolio's existing 45% Technology bucket.
    expect(output).toContain("Candidate sector: Technology");
    expect(output).toContain("Current sector exposure: Technology 45.0%, Healthcare 20.0%, Energy 10.0%");
    expect(output).toContain("Candidate industry: Semiconductors");
    expect(output).toContain("Current industry exposure: Semiconductors 15.0%");
  });

  it("still includes the ticker line and DNA/Strategy fallback text, unaffected by the new candidate fields", () => {
    const output = formatPersonalFitContext(fixture);
    expect(output).toContain("Ticker under consideration: SNDK");
    expect(output).toContain("DNA hypotheses: none yet.");
    expect(output).toContain("Strategy principles: none yet.");
  });
});
