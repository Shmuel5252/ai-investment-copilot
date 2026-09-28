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
//
// v3-2 (Grounding Semantics V3.2, Owner decisions OD-V32-1..7 frozen
// 2026-09-27): a partial match is NEITHER — a citation qualifies a compound
// claim only when it establishes every material component its stance
// requires (AND / OR preconditions, motive or basis, role by wording); both
// proposers state one behavioral proposition per claim; and the grounding
// gate may receive an interview answer's question as CONTEXT ONLY, never as
// evidence. The gate's request shape changed (labelled sections), so its id
// moves together with the two proposers. v3-1 versions keep their meaning.
export const AI_CONTRACTS = {
  dnaPropose: "dna-propose-v3-2-statements",
  strategyObserve: "strategy-observe-v3-2-statements",
  evidenceGrounding: "evidence-grounding-v3-2-statements",
  hypothesisIdentity: "hypothesis-identity-v1",
  learningPropose: "learning-propose-v1",
} as const;
