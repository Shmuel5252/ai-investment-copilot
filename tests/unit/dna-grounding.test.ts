// Evidence Grounding — the real AI-calling function's own fail-closed
// parsing logic (tested directly and purely, no network call, no
// mocking) plus the exception path (mocked client — see the module mock
// below; this is the ONLY place in this file that touches a mock, and it
// is a stand-in for a network failure, never a real API call).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseGroundingResponse } from "@/lib/ai/dna-grounding";

describe("parseGroundingResponse (pure, no network call)", () => {
  it("returns the real verdict/reason for a well-formed tool_use block", () => {
    const result = parseGroundingResponse({
      type: "tool_use",
      input: { verdict: "supported", reason: "The answer directly describes this." },
    });
    expect(result).toEqual({ verdict: "supported", reason: "The answer directly describes this." });
  });

  it("fails closed when there is no tool_use block at all", () => {
    const result = parseGroundingResponse(undefined);
    expect(result.verdict).toBe("unsupported");
  });

  it("fails closed when the block isn't a tool_use block", () => {
    const result = parseGroundingResponse({ type: "text" });
    expect(result.verdict).toBe("unsupported");
  });

  it("fails closed when verdict is not a recognized enum value", () => {
    const result = parseGroundingResponse({ type: "tool_use", input: { verdict: "maybe", reason: "x" } });
    expect(result.verdict).toBe("unsupported");
  });

  it("fails closed when reason is missing", () => {
    const result = parseGroundingResponse({ type: "tool_use", input: { verdict: "supported" } });
    expect(result.verdict).toBe("unsupported");
  });

  it("fails closed when input is completely malformed (not an object shape at all)", () => {
    const result = parseGroundingResponse({ type: "tool_use", input: "not an object" });
    expect(result.verdict).toBe("unsupported");
  });

  // The real CAN regression, at the parsing layer: even if a grounding
  // call somehow came back claiming "supported" for the CAN citation
  // (it shouldn't — that's the live-AI-judgment question a real,
  // human-approved call would need to confirm, out of scope for this
  // mock-only test), a well-formed "unsupported" verdict is parsed and
  // passed through faithfully, unmodified — parsing never overrides or
  // second-guesses a real verdict either direction.
  it("passes through a real 'unsupported' verdict for a claim like the CAN case unmodified", () => {
    const result = parseGroundingResponse({
      type: "tool_use",
      input: {
        verdict: "unsupported",
        reason:
          "The answer describes the stock declining and missing a Nasdaq compliance deadline, not a profitable position with an intact thesis and a better opportunity.",
      },
    });
    expect(result).toEqual({
      verdict: "unsupported",
      reason:
        "The answer describes the stock declining and missing a Nasdaq compliance deadline, not a profitable position with an intact thesis and a better opportunity.",
    });
  });
});

// Mocked network boundary — simulates a call failure without ever making
// a real request. checkEvidenceGrounding itself (the real function, not
// a reimplementation) is what's under test here.
vi.mock("@/lib/ai/client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: "claude-sonnet-5",
}));

// Stance-aware grounding semantics regression (pre-commit review finding
// — src/lib/ai/dna-grounding.ts's system prompt used to state one merged
// rule that could plausibly be read as "does this support the
// hypothesis?" regardless of the claimed stance, which would wrongly
// reject genuinely valid CONTRADICTING citations for correctly going
// against the hypothesis — exactly what a contradicting citation is
// supposed to do). What CAN be proven without a real API call: (a) our
// code correctly threads the real stance and the real answer text — never
// the AI-generated description — into the request; (b) the system prompt
// actually sent contains the stance-branched, non-ambiguous contract; (c)
// checkEvidenceGrounding faithfully passes through whatever verdict comes
// back, for either stance, without any stance-blind post-processing that
// could reintroduce the bug at this layer. Whether the real model applies
// the corrected rule correctly on a live call is a separate, deliberately
// out-of-scope live-model question — same disclosure as every other
// mocked-client test in this file.
describe("checkEvidenceGrounding — mocked client, no real API call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the stance-aware, non-ambiguous contract and the real stance/answer text — never the AI description", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { verdict: "supported", reason: "x" } }],
    });
    const { checkEvidenceGrounding } = await import("@/lib/ai/dna-grounding");

    await checkEvidenceGrounding({
      hypothesisStatement: "You cut losing positions when the thesis fails.",
      stance: "contradicting",
      sourceAnswerText: "The real, verbatim source answer text.",
    });

    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // The fix itself: the system prompt must state the two stances are
    // judged by different rules, and must explicitly forbid rejecting a
    // contradicting citation merely for failing to support the hypothesis.
    expect(call.system).toMatch(/DIFFERENT rules/i);
    expect(call.system).toMatch(/never reject it merely because it fails to support/i);
    // The request itself carries the real stance and real text, never a
    // model-generated description (which this function's input type
    // doesn't even accept — there is no field for it to leak through).
    const userMessage = call.messages[0].content as string;
    expect(userMessage).toContain("contradicting");
    expect(userMessage).toContain("The real, verbatim source answer text.");
  });

  it("1. valid supporting evidence is accepted", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { verdict: "supported", reason: "The answer directly establishes this behavior." } }],
    });
    const { checkEvidenceGrounding } = await import("@/lib/ai/dna-grounding");

    const result = await checkEvidenceGrounding({
      hypothesisStatement: "You hold winners as long as they keep climbing.",
      stance: "supporting",
      sourceAnswerText: "I kept holding because the stock kept going up and I believed in the company.",
    });

    expect(result.verdict).toBe("supported");
  });

  it("2. unsupported supporting evidence is rejected", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        input: {
          verdict: "unsupported",
          reason: "The answer describes a declining stock and a missed compliance deadline, not a profitable position with an intact thesis and a better opportunity.",
        },
      }],
    });
    const { checkEvidenceGrounding } = await import("@/lib/ai/dna-grounding");

    const result = await checkEvidenceGrounding({
      hypothesisStatement: "You sell a profitable position because a more attractive opportunity appeared, thesis intact.",
      stance: "supporting",
      sourceAnswerText: "The stock kept declining and missed its Nasdaq compliance deadline, so I moved the money elsewhere.",
    });

    expect(result.verdict).toBe("unsupported");
  });

  it("3. valid contradicting evidence is accepted SPECIFICALLY because the source goes against the hypothesis", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        input: {
          verdict: "supported",
          reason: "The answer shows the investor sold immediately despite the thesis still holding — the opposite of 'holds as long as it climbs'.",
        },
      }],
    });
    const { checkEvidenceGrounding } = await import("@/lib/ai/dna-grounding");

    const result = await checkEvidenceGrounding({
      hypothesisStatement: "You hold winners as long as they keep climbing.",
      stance: "contradicting",
      sourceAnswerText: "It was still going up and I still believed in it, but I sold anyway out of nerves.",
    });

    // Grounded as "supported" here means "yes, this citation genuinely
    // earns its CONTRADICTING role" — not that it supports the
    // hypothesis. The whole point of this test is that going against the
    // hypothesis is what makes a contradicting citation valid.
    expect(result.verdict).toBe("supported");
  });

  it("4. a citation labeled contradicting whose source does NOT actually contradict the hypothesis is rejected", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        input: {
          verdict: "unsupported",
          reason: "The answer is actually consistent with the hypothesis, not against it — it does not genuinely contradict the claim.",
        },
      }],
    });
    const { checkEvidenceGrounding } = await import("@/lib/ai/dna-grounding");

    const result = await checkEvidenceGrounding({
      hypothesisStatement: "You hold winners as long as they keep climbing.",
      stance: "contradicting",
      sourceAnswerText: "It kept climbing and I kept holding because I believed in the company.",
    });

    expect(result.verdict).toBe("unsupported");
  });

  it("5. malformed output and an API failure both still fail closed, for either stance", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    const { checkEvidenceGrounding } = await import("@/lib/ai/dna-grounding");

    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network error"));
    const exceptionResult = await checkEvidenceGrounding({
      hypothesisStatement: "You tend to X.",
      stance: "contradicting",
      sourceAnswerText: "Some real answer text.",
    });
    expect(exceptionResult.verdict).toBe("unsupported");

    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{ type: "text", text: "no tool call at all" }],
    });
    const malformedResult = await checkEvidenceGrounding({
      hypothesisStatement: "You tend to X.",
      stance: "supporting",
      sourceAnswerText: "Some real answer text.",
    });
    expect(malformedResult.verdict).toBe("unsupported");
  });

  // Contradicting-stance semantic hardening regression (Strategy Grounding
  // + Identity Hardening follow-up — a real, human-reviewed disagreement,
  // not a hypothetical). Generic fixtures throughout: no investor-specific
  // text, no real persisted answers, per the task's explicit constraint.
  // These tests are mocked-client, same convention as every other test in
  // this describe block — they prove (a) the real system prompt sent
  // contains the corrected contract, and (b) checkEvidenceGrounding
  // faithfully passes through whatever verdict comes back, never
  // second-guessing it. Whether a real live model actually applies the
  // corrected rule is a separate, deliberately out-of-scope live-model
  // question, same disclosure as every other mocked test here.
  it("6. a behavioral counter-example to the material headline claim is grounded even though a secondary motive clause is unobservable (the corrected contract)", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        input: {
          verdict: "supported",
          reason: "The answer shows the investor did not take the claimed action at all in this instance — a direct counter-example to the material behavior, even though no alternative motive is stated.",
        },
      }],
    });
    const { checkEvidenceGrounding } = await import("@/lib/ai/dna-grounding");

    const result = await checkEvidenceGrounding({
      hypothesisStatement: "You tend to do X because of motive M, rather than following rule R.",
      stance: "contradicting",
      sourceAnswerText: "I did not do X in this case; I did the opposite, without following rule R either.",
    });

    expect(result.verdict).toBe("supported");
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.system).toMatch(/a clear counter-example to the headline behavior is enough on its own/i);
    expect(call.system).toMatch(/do not additionally require the answer to state an alternative motive/i);
    expect(call.system).toMatch(/an unobservable secondary clause is not the same as an unproven one/i);
  });

  it("7. a citation silent about the claimed material behavior fails closed", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        input: {
          verdict: "unsupported",
          reason: "The answer never addresses whether X happened or not — silent on the material behavioral claim.",
        },
      }],
    });
    const { checkEvidenceGrounding } = await import("@/lib/ai/dna-grounding");

    const result = await checkEvidenceGrounding({
      hypothesisStatement: "You tend to do X because of motive M, rather than following rule R.",
      stance: "contradicting",
      sourceAnswerText: "I had lunch and thought about something unrelated to X entirely.",
    });

    expect(result.verdict).toBe("unsupported");
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.system).toMatch(/silent on the material behavioral claim/i);
  });

  it("8. contradicting only a non-material/trivial clause while the material behavior itself remains untouched fails closed", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        input: {
          verdict: "unsupported",
          reason: "The answer disagrees only with the trivial rule/manner detail — it still confirms the material behavior X itself happened, so this does not contradict the hypothesis.",
        },
      }],
    });
    const { checkEvidenceGrounding } = await import("@/lib/ai/dna-grounding");

    const result = await checkEvidenceGrounding({
      hypothesisStatement: "You tend to do X because of motive M, rather than following rule R.",
      stance: "contradicting",
      sourceAnswerText: "I did do X, exactly as usual, but I happened to also glance at rule R this one time before doing it.",
    });

    expect(result.verdict).toBe("unsupported");
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.system).toMatch(/contradicts only a minor or non-material detail/i);
  });

  it("9. genuinely ambiguous compound contradiction fails closed", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        input: {
          verdict: "unsupported",
          reason: "It is genuinely unclear from the answer whether X happened or not in this instance — too ambiguous to count as a counter-example.",
        },
      }],
    });
    const { checkEvidenceGrounding } = await import("@/lib/ai/dna-grounding");

    const result = await checkEvidenceGrounding({
      hypothesisStatement: "You tend to do X because of motive M, rather than following rule R.",
      stance: "contradicting",
      sourceAnswerText: "It's hard to say exactly what happened that time, things were unclear.",
    });

    expect(result.verdict).toBe("unsupported");
  });
});
