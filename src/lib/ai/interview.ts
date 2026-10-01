import { anthropic, CLAUDE_MODEL } from "./client";
import { PIT_QUESTION_CONTRACT } from "@/lib/interview/anchor-context";

// Guided Interview PIT contract (Unit 7C-B, AI contract
// interview_question_pit_v1). The model receives ONE thing: the factsLine
// rendered in code from the exposed point-in-time facts of a single
// historical action (src/lib/interview/anchor-context.ts). No transaction
// object, no category, no selection reason, no return, nothing after the
// action. It only phrases a question; whatever it returns is then checked by
// the deterministic validator (src/lib/interview/question-safety.ts), and a
// rejected or malformed answer is replaced by the code-built fallback. There
// is never a second AI call.

export { PIT_QUESTION_CONTRACT };
export const PIT_QUESTION_MODEL = CLAUDE_MODEL;

const SYSTEM_PROMPT = `You write ONE interview question for a personal investing journal. You are given a single line of facts, in Hebrew, about one past action of the investor (a buy or a sell) and the position they held immediately before it. Ask what they were thinking at that moment: what led them to act then, and what they expected or intended at the time.

Rules:
- Use only the facts in the line. Never add a number, a price, a date or a name that is not in it.
- Never mention, estimate or hint at anything that happened after the action: later prices, later trades, how the position ended, or whether the decision worked out.
- Never mention return, profit, gain, loss, percentages, performance or results.
- Never say why this action was picked, and never compare it with other trades (no "biggest", "best", "worst", "fastest", "longest", "first" or "last").
- Do not use English words. Write the ticker exactly as it appears in the line.
- Write one short, specific, non-judgmental question in natural Hebrew, with no preamble.`;

const QUESTION_TOOL = {
  name: "ask_question",
  description: "Ask the investor one question about their reasoning at the time of this action.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      question: { type: "string" as const, description: "One question in Hebrew, no preamble." },
    },
    required: ["question"],
    additionalProperties: false,
  },
};

/**
 * The model's wording for one facts line, or null when the response is
 * malformed (no tool call, empty text) — the caller then uses the
 * deterministic fallback. A transport failure throws: interview.start fails
 * before any session is created.
 */
export async function generatePitQuestion(factsLine: string): Promise<string | null> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    tools: [QUESTION_TOOL],
    tool_choice: { type: "tool", name: "ask_question" },
    messages: [{ role: "user", content: factsLine }],
  });
  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;
  const question = (toolUse.input as { question?: unknown }).question;
  return typeof question === "string" && question.trim() !== "" ? question.trim() : null;
}
