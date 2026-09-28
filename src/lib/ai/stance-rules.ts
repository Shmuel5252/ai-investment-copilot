// Grounding Semantics V3 (Owner decision, frozen 2026-09-25), V3.1
// (material preconditions, frozen 2026-09-25) and V3.2 (compound claims +
// question context, frozen 2026-09-27) — the ONE canonical statement
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
//
// Why V3.2 exists: the supervised V3.1 revalidation confirmed a contradiction
// of "you hold as long as the stock keeps climbing and you believe in the
// company" from a statement that never established the belief, and confirmed
// support for a principle whose momentum clause the statement never
// mentioned — a PARTIAL match promoted to evidence for the whole claim. The
// same run showed that an interview answer reaches the gate without its
// question, so the action an answer is about had to be inferred. V3.2
// freezes: every material component a stance requires must be established
// (OD-V32-1..5), and the question is CONTEXT that may resolve what an answer
// refers to but never supplies a component (OD-V32-7).
export const STANCE_SEMANTICS_VERSION = "grounding-semantics-v3-2" as const;

export const AFFIRMATIVE_STANCE_RULES = `STANCE SEMANTICS (contradiction requires affirmative evidence; conditional claims require their material preconditions; a partial match is NEITHER):
- SUPPORTING: the statement's own words affirmatively establish the belief, consideration, intention or action the claim describes, in that instance.
- CONTRADICTING: the statement's own words affirmatively establish a belief, consideration, intention or action that is inconsistent with the claim in that instance — the investor believed or did the opposite, or something clearly incompatible with the claim. The statement itself must positively show it.
- NEITHER: the text establishes neither direction. NEITHER is the correct reading for: silence; omission; a missing mention; ambiguity; insufficient detail; explicit uncertainty ("I don't remember whether..."); an inability to infer the claimed behavior; text that merely fails to support the claim; irrelevant text; and a different action, unless the investor's own words establish that the action was taken in disregard of the claimed principle.
Absence of mention is not evidence of absence. A decision statement (the reasoning, the risks considered, or the exit conditions the investor wrote when recording a decision) is a PARTIAL RECORD written without this claim in mind: a consideration missing from one such text does not establish that it was absent from the investor's actual decision process. Do not infer decision-process facts the text does not record.
A tendency claim ("you tend to...", "you generally...", "you often...") is not a universal claim — never read or restate it as "you always...". One instance that does not mention the behavior does not falsify a tendency; only an affirmative counter-instance can contradict it.
Unsupported is not contradiction: text that does not establish a direction contributes to neither side.
MATERIAL PRECONDITIONS: a material precondition is a condition the CLAIM ITSELF requires to hold before its behavioral proposition applies — the trigger in "when X, you tend to Y", "after X", "if X", or a stated situation such as "a winning position after a large run-up". To judge any citation of a conditional claim: (1) identify the behavioral proposition; (2) identify its material preconditions from the claim itself — never add a precondition the claim does not contain and never invent extra triggers; (3) require the statement's own words to affirmatively establish those preconditions; (4) only then ask whether the statement affirmatively establishes the behavior (SUPPORTING) or a behavior or belief inconsistent with it (CONTRADICTING). If a material precondition is absent, ambiguous, merely inferred, supplied from outside the statement, or known only from market data, hindsight, outcomes, Later Context or another uncited statement, the citation establishes NEITHER for that conditional claim: behavior outside the claim's trigger conditions is not a counter-example, and an action taken while the trigger is unknown does not prove the conditional pattern. Do not infer that a trigger occurred. Examples — claim "when momentum weakens, you tend to sell": "I held while the stock kept rising" is NEITHER (the trigger is not established); "momentum clearly weakened, but I kept holding because I expected a rebound" is CONTRADICTING; "momentum weakened and I sold" is SUPPORTING. Claim "if an external target is missed, you tend to exit": "I held the position for six months" is NEITHER unless the statement establishes that the target was missed while the investor kept holding.
Qualification is citation-local: judge each statement by its own words alone; never combine the trigger from one statement with the action from another, and never complete a statement from ticker or price history, outcomes, Later Context, other statements or general knowledge.
COMPOUND CLAIMS (a partial match is NEITHER): a claim can have several material components — its precondition(s), its behavior, and any motive, basis or manner it asserts. A citation qualifies for a stance only when the statement's own words affirmatively establish EVERY material component that stance requires. A statement that establishes only some of them is a partial match, and a partial match is never evidence for the whole claim: it is NEITHER. A required component that is missing, ambiguous, merely inferred, or supplied only by context is not established.
- Preconditions joined by AND ("when X and Z, you tend to Y"): SUPPORTING requires X, Z and Y. CONTRADICTING requires X, Z and a behavior affirmatively inconsistent with Y. X with Y only, Z with Y only, and X with not-Y only are each NEITHER.
- Preconditions joined by OR ("when X or Z, you tend to Y"): SUPPORTING requires at least one branch (X or Z) and Y. CONTRADICTING requires at least one applicable branch (X or Z) and a behavior affirmatively inconsistent with Y. Evidence for one branch says nothing about the other branch; do not infer a missing branch. Y with neither branch established is NEITHER.
- Motive, basis or manner ("when X, you tend to Y because Z"; "you tend to Y because of Z", "based on Z", "out of Z", "in order to Z"): SUPPORTING requires X when the claim has one, Y, and Z as the claimed motive or basis — a statement showing Y alone is a partial match and NEITHER. CONTRADICTING requires X when the claim has one and a behavior affirmatively inconsistent with Y; it does not require Z, and a failure to establish Z never by itself establishes contradiction.
- Role follows the claim's wording: a component inside the grammatical scope of "when", "if", "after", "while" or "as long as" is a material precondition unless the claim's wording clearly marks a different role; a component marked by "because", "based on", "out of" or "in order to" is a motive, basis or purpose. Ground the claim as written: never reclassify a worded precondition as a motive because of where the claim came from or what another source suggests. If a material component's role is genuinely ambiguous, fail closed — treat it as required, never silently drop it.
- Contrast markers ("without Z", "rather than Z"): a contrast word is not automatically a separate material component — determine its role in the claim. If it asserts an independent behavioral property of its own ("without a predefined exit rule"), that property must be established for SUPPORTING the whole claim. If it merely restates or negates the primary behavioral proposition ("you cut the position rather than hold it"), it adds no requirement — do not double-count it. CONTRADICTING requires only the components the rules above require, never the contrast as an extra one. If the role of the contrast is genuinely ambiguous, fail closed — treat it as required.
- Scope and emphasis ("especially when Z", "even if Z"): read the phrase by its grammatical role. It is not automatically a material precondition, and the base behavioral proposition does not need it established; it also never broadens what a statement establishes beyond the statement's own words.
INTERVIEW QUESTION — CONTEXT, NEVER EVIDENCE: an interview answer may come with the question it responded to (shown with the answer, or under "CONTEXT — NOT EVIDENCE"). The investor's answer is the evidence; the question is not. Context may resolve what the investor answer refers to: a pronoun or referent ("it", "that", "then"), which action or topic the answer is responding to, or an explicit question premise needed to read the answer's grammar. Context may NOT supply evidence for a missing claim component: it never establishes a motive, belief, rule, behavioral tendency, trigger or precondition, risk preference, exit discipline or confidence. Any material component supported only by context remains unsupported. Computed or AI-authored facts in context — a return, a duration, a price, a characterization such as "despite weakening momentum" — are not investor evidence. Examples — question "What made you sell then?", answer "I was afraid the gain would disappear": the answer gives the investor's stated reason for the sale being discussed, and nothing the question says about the size or speed of the gain is established. Question "Why did you hold despite weakening momentum?", answer "Because I believed in the company": the answer concerns holding and states a belief; weakening momentum is NOT established. An answer that only affirms or denies the question ("yes", "no") adopts words the investor did not write and establishes no component by itself. A decision statement has no question. When no question is given, never assume, reconstruct or invent one.`;

// Grounding Semantics V3.2 (OD-V32-6) — claim construction, stated once and
// injected into BOTH proposers (dna.ts, strategy.ts). The grounding gate does
// not propose claims, so it does not carry this text; its backstop is the
// partial-match rule above, under which an over-compound claim cannot gather
// evidence from statements that each establish only one of its parts. The
// examples are deliberately generic: they must not echo any claim the
// investor already has, or the proposer would be primed toward it.
export const CLAIM_ATOMICITY_RULES = `CLAIM ATOMICITY: each hypothesis states ONE independently testable behavioral proposition, plus only its material trigger(s) or precondition(s), its motive or basis when that motive is itself part of the proposition, and the scope or qualifiers it needs.
- Legitimate compound preconditions are allowed: several triggers on ONE behavior are one claim ("you tend to reduce a position when it outgrows your size limit or when its thesis breaks"). Do not split one behavioral rule into unnatural fragments.
- Do not join separable behavioral tendencies into one claim, and do not append an independent second tendency merely because the same statement mentions it ("you spread positions across sectors, and you check the earnings date before buying" is two separate tendencies — propose each on its own evidence, or neither).
- Every material component you write into a claim — each precondition, the behavior, a motive, a manner, an independent property a contrast asserts — must be established by the statements you cite for that stance (COMPOUND CLAIMS above). A component that the cited statements do not establish does not belong in the claim: leave it out rather than cite a partial match.`;
