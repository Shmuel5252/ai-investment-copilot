// Prompt / tool contract identifiers, persisted into provenance_json
// (src/lib/evidence/provenance.ts). Bump a value whenever the corresponding
// system prompt or tool schema changes meaning — the id is what lets a stored
// version say which contract produced it. Kept SDK-free so routers and tests
// can import it while the AI modules themselves are mocked.
//
// v3 (Grounding Semantics V3, Owner decision frozen 2026-09-25): the meaning
// of a confirmed "contradicting" citation was tightened to AFFIRMATIVE
// contradiction only (src/lib/ai/stance-rules.ts) in both proposers and the
// grounding gate. Versions whose provenance names a v2 contract were produced
// under the older, looser reading and keep that meaning — never reinterpreted.
//
// v3-1 (Grounding Semantics V3.1, Owner decision frozen 2026-09-25): a
// conditional claim ("when X -> Y") is supported or contradicted only by a
// statement that itself establishes the material precondition X; behavior
// while X is unknown is NEITHER. Both proposers and the gate state the rule,
// so all three ids move together. Dots are not used in contract ids here
// ("-v3-1-" is the canonical spelling). v3 versions keep their meaning.
export const AI_CONTRACTS = {
  dnaPropose: "dna-propose-v3-1-statements",
  strategyObserve: "strategy-observe-v3-1-statements",
  evidenceGrounding: "evidence-grounding-v3-1-statements",
  hypothesisIdentity: "hypothesis-identity-v1",
  learningPropose: "learning-propose-v1",
} as const;
