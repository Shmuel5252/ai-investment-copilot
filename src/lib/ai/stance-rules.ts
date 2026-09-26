// Grounding Semantics V3 (Owner decision, frozen 2026-09-25) and V3.1
// (material preconditions, frozen 2026-09-25) — the ONE canonical statement
// of what "supporting", "contradicting" and "neither" mean for an
// investor-authored statement, shared verbatim by the DNA proposer (dna.ts),
// the observed-Strategy proposer (strategy.ts) and the grounding gate
// (dna-grounding.ts), which the Learning -> DNA carry and both grounding
// remediations also run through. One text, so the three cannot drift.
// SDK-free.
//
// Why V3 exists: on the first real Evidence Reach regeneration the AVGO
// decision reasoning ("I believe in chips/AI, so I want to add") was
// persisted as CONTRADICTING a claim about weighing price before entering,
// solely because the text did not mention price — silence read as the
// opposite. Uncertainty must never create contradicting evidence or reduce
// confidence (docs/data-model.md §2), so contradiction requires AFFIRMATIVE
// evidence.
//
// Why V3.1 exists: the supervised V3 remediation confirmed "held while the
// stock kept rising" as contradicting "sells when momentum weakens or an
// external target is missed" — an action outside the claim's trigger read as
// a counter-example. A conditional claim (when X -> Y) is contradicted only
// by a statement that establishes X and then shows not-Y; and supported only
// by one that establishes X and Y. Behavior when X is unknown is NEITHER.
export const STANCE_SEMANTICS_VERSION = "grounding-semantics-v3-1" as const;

export const AFFIRMATIVE_STANCE_RULES = `STANCE SEMANTICS (contradiction requires affirmative evidence; conditional claims require their material preconditions):
- SUPPORTING: the statement's own words affirmatively establish the belief, consideration, intention or action the claim describes, in that instance.
- CONTRADICTING: the statement's own words affirmatively establish a belief, consideration, intention or action that is inconsistent with the claim in that instance — the investor believed or did the opposite, or something clearly incompatible with the claim. The statement itself must positively show it.
- NEITHER: the text establishes neither direction. NEITHER is the correct reading for: silence; omission; a missing mention; ambiguity; insufficient detail; explicit uncertainty ("I don't remember whether..."); an inability to infer the claimed behavior; text that merely fails to support the claim; irrelevant text; and a different action, unless the investor's own words establish that the action was taken in disregard of the claimed principle.
Absence of mention is not evidence of absence. A decision statement (the reasoning, the risks considered, or the exit conditions the investor wrote when recording a decision) is a PARTIAL RECORD written without this claim in mind: a consideration missing from one such text does not establish that it was absent from the investor's actual decision process. Do not infer decision-process facts the text does not record.
A tendency claim ("you tend to...", "you generally...", "you often...") is not a universal claim — never read or restate it as "you always...". One instance that does not mention the behavior does not falsify a tendency; only an affirmative counter-instance can contradict it.
Unsupported is not contradiction: text that does not establish a direction contributes to neither side.
MATERIAL PRECONDITIONS: a material precondition is a condition the CLAIM ITSELF requires to hold before its behavioral proposition applies — the trigger in "when X, you tend to Y", "after X", "if X", or a stated situation such as "a winning position after a large run-up". To judge any citation of a conditional claim: (1) identify the behavioral proposition; (2) identify its material preconditions from the claim itself — never add a precondition the claim does not contain and never invent extra triggers; (3) require the statement's own words to affirmatively establish those preconditions; (4) only then ask whether the statement affirmatively establishes the behavior (SUPPORTING) or a behavior or belief inconsistent with it (CONTRADICTING). If a material precondition is absent, ambiguous, merely inferred, supplied from outside the statement, or known only from market data, hindsight, outcomes, Later Context or another uncited statement, the citation establishes NEITHER for that conditional claim: behavior outside the claim's trigger conditions is not a counter-example, and an action taken while the trigger is unknown does not prove the conditional pattern. Do not infer that a trigger occurred. Examples — claim "when momentum weakens, you tend to sell": "I held while the stock kept rising" is NEITHER (the trigger is not established); "momentum clearly weakened, but I kept holding because I expected a rebound" is CONTRADICTING; "momentum weakened and I sold" is SUPPORTING. Claim "if an external target is missed, you tend to exit": "I held the position for six months" is NEITHER unless the statement establishes that the target was missed while the investor kept holding.
Qualification is citation-local: judge each statement by its own words alone; never combine the trigger from one statement with the action from another, and never complete a statement from ticker or price history, outcomes, Later Context, other statements or general knowledge.`;
