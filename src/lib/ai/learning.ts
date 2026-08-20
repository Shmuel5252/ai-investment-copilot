import { anthropic, CLAUDE_MODEL } from "./client";

// Learning Insight synthesis (docs/architecture.md §2.8: "סינתזת משמעות
// — AI") — given a family of the investor's own reviewed decisions that
// share a real trait (currently: sector, computed in code — see
// src/lib/learning/group-decisions.ts), proposes what pattern, if any,
// actually holds across them. Mirrors src/lib/ai/dna.ts's shape and
// trust boundary exactly: every citation is a real DecisionReview id,
// validated by the caller (src/lib/learning/validate-insight-evidence.ts)
// before anything is written.

export interface DecisionForAnalysis {
  decisionReviewId: string;
  ticker: string;
  decisionType: string;
  decisionDate: string;
  decisionQualityOverall: string;
  thesisAccuracy: string;
  outcomeSummary: string;
  narrativeSummaryText: string;
  /**
   * Additions the investor made after the decision (docs/CLAUDE.md
   * Historical Integrity) — passed through explicitly here, not just
   * hoped to survive into narrativeSummaryText, because a decision can
   * be flagged as a deliberate non-representative test (e.g. "recorded
   * to test system behavior on an atypical stock, not a genuine
   * thesis") and that must reliably reach this call, which is exactly
   * where a real behavioral pattern gets asserted about the investor.
   */
  laterContexts: string[];
}

export interface ProposedInsightEvidence {
  decisionReviewId: string;
  stance: "supporting" | "contradicting";
  description: string;
}

export interface ProposedLearningInsight {
  statementText: string;
  evidence: ProposedInsightEvidence[];
}

const SYSTEM_PROMPT = `You look for a genuine recurring pattern across a group of a personal investor's own past decisions that all share one real trait (a sector). Each decision comes with its actual Decision Review results — process quality, thesis accuracy, and outcome — already computed, not your job to judge.

Ground rules:
- Only propose a pattern if you can point to specific decisions (by their exact "Review ID") as evidence. A pattern with no evidence is useless — don't propose one.
- Cite evidence using the exact "Review ID" given for each decision. Never invent an ID, and never cite a decision as evidence for something it doesn't actually support.
- Distinguish supporting from contradicting evidence honestly — if one decision in the group doesn't fit the pattern, cite it as contradicting, don't omit it or pretend the pattern is cleaner than it is.
- Separate Skill From Luck explicitly: a decision with a good outcome but a weak/insufficient-evidence process is NOT supporting evidence for "this investor is good at X" — if anything it's a caution. Ground the pattern in process quality and thesis accuracy, not just P&L.
- If a decision's "Later Context" says it was a deliberate test, not representative of genuine behavior, an atypical trade, or similar — do NOT cite that decision as evidence (supporting or contradicting) for a real behavioral pattern at all. Treat it as if it weren't in the family; a synthetic test case says nothing real about how this investor actually invests.
- It is completely fine, and expected with few decisions, to describe a thin or uncertain pattern — that's for the system to label via evidence strength, not for you to oversell.
- Write the statement the way you'd describe a real tendency to the investor directly ("You tend to...", "Your decisions in this sector..."), grounded only in what's actually in the reviews you were given — never invent numbers or facts not present in the text you were given.`;

const TOOL = {
  name: "propose_learning_insight",
  description: "Propose a pattern observed across a family of the investor's own reviewed decisions, backed by cited evidence.",
  input_schema: {
    type: "object" as const,
    properties: {
      statementText: {
        type: "string" as const,
        description: "The pattern, phrased as a direct observation to the investor.",
      },
      evidence: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            decisionReviewId: { type: "string" as const },
            stance: { type: "string" as const, enum: ["supporting", "contradicting"] },
            description: {
              type: "string" as const,
              description: "One sentence on how this specific decision's review supports or contradicts the pattern.",
            },
          },
          required: ["decisionReviewId", "stance", "description"],
        },
      },
    },
    required: ["statementText", "evidence"],
  },
};

function formatDecisions(family: string, decisions: DecisionForAnalysis[]): string {
  const rows = decisions
    .map(
      (d) =>
        `Review ID: ${d.decisionReviewId}\n${d.decisionType} ${d.ticker} on ${d.decisionDate}\nDecision quality: ${d.decisionQualityOverall} | Thesis accuracy: ${d.thesisAccuracy}\nOutcome: ${d.outcomeSummary}\nReview narrative: ${d.narrativeSummaryText}\nLater Context: ${d.laterContexts.length > 0 ? d.laterContexts.join(" | ") : "(none)"}`
    )
    .join("\n\n");
  return `Family (shared sector): ${family}\n\n${rows}`;
}

export async function proposeLearningInsight(
  family: string,
  decisions: DecisionForAnalysis[]
): Promise<ProposedLearningInsight> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "propose_learning_insight" },
    messages: [{ role: "user", content: formatDecisions(family, decisions) }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return a learning insight via the expected tool call.");
  }

  return toolUse.input as ProposedLearningInsight;
}
