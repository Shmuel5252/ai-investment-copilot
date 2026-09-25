// Grounding Semantics V3 (Owner decision, frozen 2026-09-25) — the ONE
// canonical statement of what "supporting", "contradicting" and "neither"
// mean for an investor-authored statement, shared verbatim by the DNA
// proposer (dna.ts), the observed-Strategy proposer (strategy.ts) and the
// grounding gate (dna-grounding.ts), which the Learning -> DNA carry and both
// grounding remediations also run through. One text, so the three cannot
// drift. SDK-free.
//
// Why it exists: on the first real Evidence Reach regeneration the AVGO
// decision reasoning ("I believe in chips/AI, so I want to add") was
// persisted as CONTRADICTING a claim about weighing price before entering,
// solely because the text did not mention price — silence read as the
// opposite. Uncertainty must never create contradicting evidence or reduce
// confidence (docs/data-model.md §2), so contradiction now requires
// AFFIRMATIVE evidence.
export const STANCE_SEMANTICS_VERSION = "grounding-semantics-v3" as const;

export const AFFIRMATIVE_STANCE_RULES = `STANCE SEMANTICS (contradiction requires affirmative evidence):
- SUPPORTING: the statement's own words affirmatively establish the belief, consideration, intention or action the claim describes, in that instance.
- CONTRADICTING: the statement's own words affirmatively establish a belief, consideration, intention or action that is inconsistent with the claim in that instance — the investor believed or did the opposite, or something clearly incompatible with the claim. The statement itself must positively show it.
- NEITHER: the text establishes neither direction. NEITHER is the correct reading for: silence; omission; a missing mention; ambiguity; insufficient detail; explicit uncertainty ("I don't remember whether..."); an inability to infer the claimed behavior; text that merely fails to support the claim; irrelevant text; and a different action, unless the investor's own words establish that the action was taken in disregard of the claimed principle.
Absence of mention is not evidence of absence. A decision statement (the reasoning, the risks considered, or the exit conditions the investor wrote when recording a decision) is a PARTIAL RECORD written without this claim in mind: a consideration missing from one such text does not establish that it was absent from the investor's actual decision process. Do not infer decision-process facts the text does not record.
A tendency claim ("you tend to...", "you generally...", "you often...") is not a universal claim — never read or restate it as "you always...". One instance that does not mention the behavior does not falsify a tendency; only an affirmative counter-instance can contradict it.
Unsupported is not contradiction: text that does not establish a direction contributes to neither side.`;
