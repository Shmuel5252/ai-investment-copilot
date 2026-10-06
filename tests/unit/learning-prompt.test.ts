// Unit 7/B — the first real Learning Insight said "you tend to skip..." from a
// single BUY. The REAL system prompt (captured at the mocked Anthropic client
// boundary) must carry the rule that thin evidence gets descriptive wording.
import { describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ system: "" }));
vi.mock("@/lib/ai/client", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: async (req: { system: string }) => {
        sent.system = req.system;
        return { content: [{ type: "tool_use", name: "propose_learning_insight", input: { statementText: "s", evidence: [] } }] };
      },
    },
  },
}));

import { proposeLearningInsight } from "@/lib/ai/learning";

describe("Learning Insight prompt — wording matches the evidence", () => {
  it("forbids generalizations for claims resting on one decision or fewer than three of the relevant kind", async () => {
    await proposeLearningInsight("Technology", []);
    expect(sent.system).toContain("When a claim rests on a single decision, or on fewer than three decisions of the relevant kind");
    expect(sent.system).toContain(`("In the one BUY reviewed, you...")`);
    expect(sent.system).toMatch(/do NOT use "tend to", "usually", "always"/);
  });
});
