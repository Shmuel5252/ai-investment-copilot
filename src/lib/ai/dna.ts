import { anthropic, CLAUDE_MODEL } from "./client";
import { normalizeStructuredCollection } from "./structured-output";

export interface InterviewAnswerForAnalysis {
  id: string;
  questionText: string;
  answerText: string;
}

export interface ProposedEvidence {
  interviewAnswerId: string;
  stance: "supporting" | "contradicting";
  description: string;
}

export interface ProposedHypothesis {
  statement: string;
  evidence: ProposedEvidence[];
}

const SYSTEM_PROMPT = `You analyze a personal investor's onboarding interview answers to propose hypotheses about recurring patterns in how they think and behave as an investor — not one-off observations about a single trade.

Write each hypothesis's statement and each evidence description in Hebrew — natural, fluent Hebrew, not a forced or literal translation. Keep tickers, company/product names, and established financial terms (e.g. P/E, margin of safety) in English exactly as an investor writing in natural mixed Hebrew/English would — that mixed style is expected, not a fallback. Keep these fixed terms in English exactly as spelled, never translated: DNA, Evidence Strength, Personal Fit, Portfolio Fit, and Strategy (when naming a Strategy principle specifically). This is about the wording only — it does not change which answer you cite or whether evidence is supporting or contradicting.

Ground rules:
- Only propose a hypothesis if you can point to specific interview answers as evidence. A hypothesis with no evidence is useless — don't propose it.
- Cite evidence using the exact "Answer ID" given for each answer. Never invent an ID, and never cite an answer as evidence for something it doesn't actually support.
- Do not overclaim: a hypothesis (and its evidence description) should describe only the behavioral tendency the answer actually shows, never a broader stated preference or goal you're inferring from it. For example, an answer showing more confidence deciding on a company the investor already knew well supports "you tend to feel more confident in familiar names" — it does NOT support "you prefer to avoid unfamiliar companies", a stronger, different claim the answer doesn't establish. This applies to the evidence description too, not just the hypothesis statement: describe what the answer actually says, not the wider conclusion you're drawing from it.
- Distinguish supporting from contradicting evidence honestly — if an answer partially undercuts a pattern you're proposing, cite it as contradicting, don't omit it.
- It is completely fine, and expected with a small number of answers, to propose few hypotheses (even just one) or hypotheses with only 1-2 pieces of evidence — thin evidence is for the system to flag as low-confidence, not for you to pad or oversell.
- Write each hypothesis statement the way you'd describe a real tendency to the investor directly ("You tend to...", "You seem to prefer..."), grounded only in what's actually in the answers — never invent numbers, percentages, or facts not present in the text you were given.
- Propose at most 5 hypotheses.`;

const PROPOSE_TOOL = {
  name: "propose_hypotheses",
  description: "Propose behavioral hypotheses about the investor, each backed by cited evidence.",
  // Strict tool use forces `hypotheses` to be a real array (the same-shaped observed-principles tool came back string-encoded live); requires additionalProperties:false on EVERY object.
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      hypotheses: {
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
                  interviewAnswerId: { type: "string" as const },
                  stance: { type: "string" as const, enum: ["supporting", "contradicting"] },
                  description: {
                    type: "string" as const,
                    description: "One sentence on how this specific answer supports or contradicts the hypothesis.",
                  },
                },
                required: ["interviewAnswerId", "stance", "description"],
                additionalProperties: false,
              },
            },
          },
          required: ["statement", "evidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["hypotheses"],
    additionalProperties: false,
  },
};

function formatAnswers(answers: InterviewAnswerForAnalysis[]): string {
  return answers
    .map((a) => `Answer ID: ${a.id}\nQuestion: ${a.questionText}\nAnswer: ${a.answerText}`)
    .join("\n\n");
}

export async function proposeDnaHypotheses(
  answers: InterviewAnswerForAnalysis[]
): Promise<ProposedHypothesis[]> {
  if (answers.length === 0) return [];

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    tools: [PROPOSE_TOOL],
    tool_choice: { type: "tool", name: "propose_hypotheses" },
    messages: [
      {
        role: "user",
        content: `Here are this investor's onboarding interview answers:\n\n${formatAnswers(answers)}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return hypotheses via the expected tool call.");
  }

  // Representation-only normalization (structured-output.ts) — whether
  // cited answer IDs actually exist is validated by the caller against
  // the real DB rows (src/server/routers/dna.ts), since this function
  // has no DB access and shouldn't be trusted to police its own
  // citations.
  return normalizeStructuredCollection(toolUse.input, "hypotheses", "hypotheses") as ProposedHypothesis[];
}
