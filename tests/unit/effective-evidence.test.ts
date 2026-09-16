// Pure decision logic behind getEffectiveEvidenceForDnaHypothesisVersion()
// (src/db/repositories/evidence.ts) — no DB involved, exercises the real
// production function directly (DNA Grounding Remediation task).
import { describe, expect, it } from "vitest";
import { selectEffectiveEvidence } from "@/lib/dna/effective-evidence";

describe("selectEffectiveEvidence", () => {
  it("legacy version with no grounding-check rows preserves the full raw evidence set unchanged", () => {
    const rawEvidence = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = selectEffectiveEvidence(rawEvidence, []);
    expect(result).toEqual(rawEvidence);
  });

  it("a grounded version exposes only the evidence logged 'supported' for it, excluding rejected citations and citations belonging to raw evidence outside this version's checks", () => {
    const rawEvidence = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = selectEffectiveEvidence(rawEvidence, [
      { evidenceId: "a", verdict: "supported" },
      { evidenceId: "b", verdict: "unsupported" },
      { evidenceId: "c", verdict: "supported" },
    ]);
    expect(result.map((e) => e.id).sort()).toEqual(["a", "c"]);
  });

  it("does not mutate the raw evidence array it was given", () => {
    const rawEvidence = [{ id: "a" }, { id: "b" }];
    const snapshot = JSON.parse(JSON.stringify(rawEvidence));
    selectEffectiveEvidence(rawEvidence, [{ evidenceId: "a", verdict: "supported" }]);
    expect(rawEvidence).toEqual(snapshot);
  });
});
