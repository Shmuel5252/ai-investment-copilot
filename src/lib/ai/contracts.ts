// Prompt / tool contract identifiers, persisted into provenance_json
// (src/lib/evidence/provenance.ts). Bump a value whenever the corresponding
// system prompt or tool schema changes meaning — the id is what lets a stored
// version say which contract produced it. Kept SDK-free so routers and tests
// can import it while the AI modules themselves are mocked.
export const AI_CONTRACTS = {
  dnaPropose: "dna-propose-v2-statements",
  strategyObserve: "strategy-observe-v2-statements",
  evidenceGrounding: "evidence-grounding-v2-statements",
  hypothesisIdentity: "hypothesis-identity-v1",
  learningPropose: "learning-propose-v1",
} as const;
