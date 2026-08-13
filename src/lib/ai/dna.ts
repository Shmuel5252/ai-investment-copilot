import { anthropic, CLAUDE_MODEL } from "./client";

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

Ground rules:
- Only propose a hypothesis if you can point to specific interview answers as evidence. A hypothesis with no evidence is useless — don't propose it.
- Cite evidence using the exact "Answer ID" given for each answer. Never invent an ID, and never cite an answer as evidence for something it doesn't actually support.
- Distinguish supporting from contradicting evidence honestly — if an answer partially undercuts a pattern you're proposing, cite it as contradicting, don't omit it.
- It is completely fine, and expected with a small number of answers, to propose few hypotheses (even just one) or hypotheses with only 1-2 pieces of evidence — thin evidence is for the system to flag as low-confidence, not for you to pad or oversell.
- Write each hypothesis statement the way you'd describe a real tendency to the investor directly ("You tend to...", "You seem to prefer..."), grounded only in what's actually in the answers — never invent numbers, percentages, or facts not present in the text you were given.
- Propose at most 5 hypotheses.`;

const PROPOSE_TOOL = {
  name: "propose_hypotheses",
  description: "Propose behavioral hypotheses about the investor, each backed by cited evidence.",
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
              },
            },
          },
          required: ["statement", "evidence"],
        },
      },
    },
    required: ["hypotheses"],
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

  const input = toolUse.input as { hypotheses?: unknown };
  if (!Array.isArray(input.hypotheses)) {
    throw new Error("AI returned a malformed hypotheses list.");
  }

  // Structural validation only here (right shape) — whether cited
  // answer IDs actually exist is validated by the caller against the
  // real DB rows (src/server/routers/dna.ts), since this function has
  // no DB access and shouldn't be trusted to police its own citations.
  return input.hypotheses as ProposedHypothesis[];
}
