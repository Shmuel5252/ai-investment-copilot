import { anthropic, CLAUDE_MODEL } from "./client";
import { normalizeStructuredCollection } from "./structured-output";
import { formatInvestorStatements, INVESTOR_STATEMENT_RULES, type InvestorStatementForAnalysis } from "./investor-statements";
import { AFFIRMATIVE_STANCE_RULES } from "./stance-rules";

export interface InterviewAnswerForAnalysis {
  id: string;
  questionText: string;
  answerText: string;
}

// ---------------------------------------------------------------------
// Declared principles — rules/preferences the investor stated explicitly
// in their own words (docs/architecture.md §2.4: "Declared מהצהרות ראיון
// (AI מחלץ, משתמש מאשר)"). This is transcription/normalization of what
// was actually said, not inference of a pattern — that's Observed's job
// below. Every candidate must cite the answer(s) it came from; the caller
// still validates those citations against real rows and requires
// explicit user confirmation before anything is persisted (unlike
// Observed/DNA, which are written immediately and can be rejected
// afterward).
// ---------------------------------------------------------------------

export interface ProposedDeclaredPrinciple {
  statementText: string;
  rationaleText: string;
  citedAnswerIds: string[];
}

const DECLARE_SYSTEM_PROMPT = `You read a personal investor's onboarding interview answers and pull out any explicit rule, preference, or guideline they stated about how they invest — something they said they do, avoid, or require of themselves. This is NOT about inferring a pattern from their behavior; it's about transcribing a rule they actually put into words (e.g. "I never put more than a small slice into one stock", "I always wait for a pullback before buying", "I don't touch anything I don't understand").

Write statementText and rationaleText in Hebrew — natural, fluent Hebrew, not a forced or literal translation. Keep tickers, company/product names, and established financial terms (e.g. P/E, margin of safety) in English exactly as an investor writing in natural mixed Hebrew/English would — that mixed style is expected, not a fallback. Keep these fixed terms in English exactly as spelled, never translated: DNA, Evidence Strength, Personal Fit, Portfolio Fit, and Strategy (when naming a Strategy principle specifically).

Ground rules:
- Only extract a principle if the investor's own words state it as a rule or preference they hold — not a one-off comment about a single trade, and not something you're inferring from their behavior without them saying it.
- Cite the exact "Answer ID" of every answer that states this rule. Never invent an ID.
- Normalize the wording into a clear standalone statement (first person, e.g. "I keep position sizes below roughly 10% of the portfolio"), but never add numbers, thresholds, or specifics the investor didn't actually give.
- rationaleText should reflect the investor's own stated reasoning for the rule, if they gave one — if they didn't explain why, say plainly that no reasoning was given rather than inventing one.
- If nothing in the answers states an explicit rule, return an empty list — that's a completely normal, expected result, not a failure.
- Propose at most 5 principles.`;

const DECLARE_TOOL = {
  name: "propose_declared_principles",
  description: "Extract explicit, investor-stated investing rules/preferences from interview answers.",
  // Strict tool use forces `principles` to be a real array (the same-shaped observed-principles tool came back string-encoded live); requires additionalProperties:false on EVERY object.
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      principles: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            statementText: {
              type: "string" as const,
              description: "The rule, normalized to a standalone first-person statement.",
            },
            rationaleText: {
              type: "string" as const,
              description: "The investor's own stated reasoning, or a note that none was given.",
            },
            citedAnswerIds: {
              type: "array" as const,
              items: { type: "string" as const },
              description: "Answer ID(s) where the investor actually stated this rule.",
            },
          },
          required: ["statementText", "rationaleText", "citedAnswerIds"],
          additionalProperties: false,
        },
      },
    },
    required: ["principles"],
    additionalProperties: false,
  },
};

function formatAnswers(answers: InterviewAnswerForAnalysis[]): string {
  return answers
    .map((a) => `Answer ID: ${a.id}\nQuestion: ${a.questionText}\nAnswer: ${a.answerText}`)
    .join("\n\n");
}

export async function extractDeclaredPrinciples(
  answers: InterviewAnswerForAnalysis[]
): Promise<ProposedDeclaredPrinciple[]> {
  if (answers.length === 0) return [];

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system: DECLARE_SYSTEM_PROMPT,
    tools: [DECLARE_TOOL],
    tool_choice: { type: "tool", name: "propose_declared_principles" },
    messages: [
      {
        role: "user",
        content: `Here are this investor's onboarding interview answers:\n\n${formatAnswers(answers)}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return declared principles via the expected tool call.");
  }

  // Representation-only normalization (structured-output.ts) — the
  // items are still unvalidated here; real citation-id checking happens
  // in src/lib/strategy/validate-principles.ts against actual DB rows.
  return normalizeStructuredCollection(
    toolUse.input,
    "principles",
    "declared-principles"
  ) as ProposedDeclaredPrinciple[];
}

// ---------------------------------------------------------------------
// Observed principles — "same Evidence engine as DNA"
// (docs/architecture.md §2.4), just scoped to risk/strategy-relevant
// behavior (position sizing, diversification, exit discipline, averaging
// down, holding-period consistency) rather than DNA's general behavioral
// patterns. Shape mirrors src/lib/ai/dna.ts's ProposedHypothesis exactly;
// kept as a separate type here so this module doesn't depend on the DNA
// module for something that's conceptually a different question.
// ---------------------------------------------------------------------

export interface ProposedPrincipleEvidence {
  /** An interview-answer uuid or a "decision:<id>:<kind>" statement id — parsed and validated in code, never trusted. */
  statementId: string;
  stance: "supporting" | "contradicting";
  description: string;
}

export interface ProposedObservedPrinciple {
  statement: string;
  evidence: ProposedPrincipleEvidence[];
}

const OBSERVE_SYSTEM_PROMPT = `You analyze statements a personal investor wrote themselves — onboarding interview answers about their trades, and what they wrote when recording investment decisions — to propose hypotheses about recurring risk-management and strategy-relevant behavior — position sizing habits, diversification, exit/stop discipline, whether they average down, holding-period consistency. This is specifically about risk and strategy behavior, not general psychology (that's covered elsewhere) — don't propose a hypothesis about something outside that scope.

${INVESTOR_STATEMENT_RULES}

${AFFIRMATIVE_STANCE_RULES}

Write each hypothesis's statement and each evidence description in Hebrew — natural, fluent Hebrew, not a forced or literal translation. Keep tickers, company/product names, and established financial terms (e.g. P/E, margin of safety) in English exactly as an investor writing in natural mixed Hebrew/English would — that mixed style is expected, not a fallback. Keep these fixed terms in English exactly as spelled, never translated: DNA, Evidence Strength, Personal Fit, Portfolio Fit, and Strategy (when naming a Strategy principle specifically). This is about the wording only — it does not change which answer you cite or whether evidence is supporting or contradicting.

Ground rules:
- Only propose a hypothesis if you can point to specific statements as evidence. A hypothesis with no evidence is useless — don't propose it.
- Cite evidence using the exact "Statement ID" given for each statement. Never invent an ID, and never cite a statement as evidence for something it doesn't actually support.
- Do not overclaim: a hypothesis (and its evidence description) should describe only the behavioral tendency the statement actually shows, never a broader stated preference or goal you're inferring from it. For example, an answer showing more confidence deciding on a company the investor already knew well supports "you tend to feel more confident in familiar names" — it does NOT support "you prefer to avoid unfamiliar companies", a stronger, different claim the answer doesn't establish. This applies to the evidence description too, not just the hypothesis statement: describe what the statement actually says, not the wider conclusion you're drawing from it.
- Distinguish supporting from contradicting evidence honestly — if a statement affirmatively undercuts a pattern you're proposing, cite it as contradicting rather than omitting it. But cite a statement as "contradicting" ONLY when its own words affirmatively establish something inconsistent with the hypothesis (STANCE SEMANTICS above): never because the claimed behavior is not mentioned, because the investor did something different, because a partial decision record lacks the consideration, or because the text fails to support the claim. A statement that establishes neither direction is simply not cited — not citing it is the correct outcome, not a loss.
- It is completely fine, and expected with a small number of statements, to propose few hypotheses (even none) or hypotheses with only 1-2 pieces of evidence — thin evidence is for the system to flag as low-confidence, not for you to pad or oversell.
- Write each hypothesis statement the way you'd describe a real tendency to the investor directly ("You tend to...", "You seem to..."), grounded only in what's actually in the statements — never invent numbers, percentages, or facts not present in the text you were given.
- Keep tendency language as tendency: never restate "you tend to" as "you always", "you never" or "in every case" — a universal claim would need every cited statement to establish it, and a single silent instance never contradicts a tendency.
- Propose at most 5 hypotheses.`;

const OBSERVE_TOOL = {
  name: "propose_observed_principles",
  description:
    "Propose risk/strategy-behavior hypotheses about the investor, each backed by cited evidence.",
  // Strict tool use forces `principles` to be a real array (live runs returned it string-encoded); requires additionalProperties:false on EVERY object.
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      principles: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            statement: {
              type: "string" as const,
              description: "The hypothesis, phrased as a direct observation to the investor.",
            },
            evidence: {
              type: "array" as const,
              items: {
                type: "object" as const,
                properties: {
                  statementId: { type: "string" as const, description: "The exact Statement ID of the cited statement." },
                  stance: { type: "string" as const, enum: ["supporting", "contradicting"] },
                  description: {
                    type: "string" as const,
                    description: "One sentence on how this specific statement supports or contradicts the hypothesis.",
                  },
                },
                required: ["statementId", "stance", "description"],
                additionalProperties: false,
              },
            },
          },
          required: ["statement", "evidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["principles"],
    additionalProperties: false,
  },
};

export async function proposeObservedPrinciples(
  statements: InvestorStatementForAnalysis[]
): Promise<ProposedObservedPrinciple[]> {
  if (statements.length === 0) return [];

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system: OBSERVE_SYSTEM_PROMPT,
    tools: [OBSERVE_TOOL],
    tool_choice: { type: "tool", name: "propose_observed_principles" },
    messages: [
      {
        role: "user",
        content: `Here are the statements this investor wrote:\n\n${formatInvestorStatements(statements)}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return observed principles via the expected tool call.");
  }

  return normalizeStructuredCollection(
    toolUse.input,
    "principles",
    "observed-principles"
  ) as ProposedObservedPrinciple[];
}
