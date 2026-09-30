// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceTierBadge, EVIDENCE_TIERS, EVIDENCE_TIER_TONE, isEvidenceTier } from "@/components/ui/badge";
import { evidenceStrengthLabel, evidenceTierHint } from "@/lib/i18n/strings";

// Frontend V1, unit 1 — the evidence tier is a product state. The badge
// must show the tier the backend computed, word for word from the shared
// label map, and must never dress an unknown value up as a real tier.
describe("EvidenceTierBadge", () => {
  it("shows the shared label for every tier, with the tier's own hint", () => {
    for (const tier of EVIDENCE_TIERS) {
      const { unmount } = render(<EvidenceTierBadge tier={tier} showHint />);
      expect(screen.getByText(evidenceStrengthLabel[tier]!)).toBeTruthy();
      expect(screen.getByText(evidenceTierHint[tier]!)).toBeTruthy();
      unmount();
    }
  });

  it("keeps the fixed English term and never translates it", () => {
    render(<EvidenceTierBadge tier="moderate" showHint />);
    expect(screen.getByText("Evidence Strength:")).toBeTruthy();
  });

  it("renders an unknown or missing tier as a dash, never as a tier", () => {
    for (const value of [null, undefined, "reasonable", ""]) {
      const { container, unmount } = render(<EvidenceTierBadge tier={value} />);
      expect(container.textContent).toBe("—");
      unmount();
    }
    expect(isEvidenceTier("strong")).toBe(true);
    expect(isEvidenceTier("reasonable")).toBe(false);
  });

  it("maps the four tiers to four distinct tones in ascending confidence", () => {
    expect(EVIDENCE_TIERS.map((t) => EVIDENCE_TIER_TONE[t])).toEqual(["neutral", "caution", "info", "positive"]);
  });
});
