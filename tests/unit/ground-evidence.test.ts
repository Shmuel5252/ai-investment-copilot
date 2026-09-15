// Evidence Grounding orchestration — tested with an INJECTED, fully
// deterministic grounding-check function, never a real Anthropic call
// (matches this codebase's existing convention: validate-hypotheses.test.ts
// tests validateProposedHypotheses() with synthetic ProposedHypothesis[]
// input rather than really calling proposeDnaHypotheses()). What's under
// test here is groundValidatedHypotheses() itself — the real production
// filtering/recomputation logic — not a reimplementation of it.
//
// The real CAN case is used as a regression fixture with its actual
// persisted answer text. Note precisely what this proves and what it
// doesn't: it proves the ORCHESTRATION correctly excludes a citation the
// grounding check reports as unsupported and recomputes strength from
// what survives. Whether the real AI would actually classify this
// specific CAN citation as unsupported is a live-model judgment call,
// deliberately NOT exercised here — that would need a real, separately
// human-approved API call (see the implementation report).
import { describe, expect, it } from "vitest";
import { groundValidatedHypotheses, type GroundingCheckFn } from "@/lib/dna/ground-evidence";
import type { ValidatedHypothesis } from "@/lib/dna/validate-hypotheses";

const REAL_CAN_ANSWER_TEXT =
  "כי כבר נאסדק נתנה להם יעד לעבור את הדולר תוך תקופת זמן מסוימת והם לא היו בכיוון של עלייה המנייה המשיכה לרדת ולרדת וכבר זה לא השתלם להשאר העדפתי להשתמש בכסף בחברות אחרות";
const OVERCLAIMING_STATEMENT =
  "אתה נוטה למכור פוזיציה מרוויחה כשמתעוררת הזדמנות חדשה שנראית אטרקטיבית יותר, גם מבלי שהתזה המקורית השתנתה.";

function hypothesis(statement: string, evidence: ValidatedHypothesis["evidence"]): ValidatedHypothesis {
  return {
    statement,
    evidence,
    supportingCount: 0, // pre-grounding placeholder — groundValidatedHypotheses always recomputes
    contradictingCount: 0,
    evidenceStrength: "insufficient_evidence",
  };
}

describe("groundValidatedHypotheses", () => {
  it("keeps a clearly valid, well-grounded supporting citation and recomputes strength from it", async () => {
    const h = hypothesis("You tend to hold winners.", [
      { interviewAnswerId: "a1", stance: "supporting", description: "Held through a rally." },
    ]);
    const checkGrounding: GroundingCheckFn = async () => ({ verdict: "supported", reason: "matches" });

    const { hypotheses, excluded, droppedHypotheses } = await groundValidatedHypotheses(
      [h],
      new Map([["a1", "Real answer text describing holding through a rally."]]),
      new Map([["a1", "TICK#1"]]),
      checkGrounding
    );

    expect(droppedHypotheses).toEqual([]);
    expect(excluded).toEqual([]);
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0]?.supportingCount).toBe(1);
    expect(hypotheses[0]?.evidence).toHaveLength(1);
  });

  it("excludes a materially unsupported citation and drops the hypothesis if nothing else survives", async () => {
    const h = hypothesis("You tend to do something the evidence never actually shows.", [
      { interviewAnswerId: "a1", stance: "supporting", description: "A selectively reframed description." },
    ]);
    const checkGrounding: GroundingCheckFn = async () => ({ verdict: "unsupported", reason: "does not hold up" });

    const { hypotheses, excluded, droppedHypotheses } = await groundValidatedHypotheses(
      [h],
      new Map([["a1", "The real answer text says something else entirely."]]),
      new Map([["a1", "TICK#1"]]),
      checkGrounding
    );

    expect(hypotheses).toEqual([]);
    expect(droppedHypotheses).toEqual(["You tend to do something the evidence never actually shows."]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.reason).toBe("does not hold up");
  });

  it("excludes a materially contradictory citation the same way (a citation proposed as supporting that the source actually undercuts)", async () => {
    // "Contradictory" here means the source answer's own content
    // undercuts the claimed stance (not just is silent on it) — the
    // grounding check's verdict is still the same binary
    // supported/unsupported; the orchestration treats both failure modes
    // identically, which is the conservative, correct behavior (never
    // invent a third "supported anyway" outcome).
    const h = hypothesis("You sold because your thesis was proven wrong.", [
      { interviewAnswerId: "a1", stance: "supporting", description: "Framed as thesis-driven." },
    ]);
    const checkGrounding: GroundingCheckFn = async () => ({
      verdict: "unsupported",
      reason: "The answer's own words describe the opposite — the thesis held, unrelated reasons drove the sale.",
    });

    const { hypotheses } = await groundValidatedHypotheses(
      [h],
      new Map([["a1", "Real text describing an unrelated reason, thesis intact."]]),
      new Map([["a1", "TICK#1"]]),
      checkGrounding
    );

    expect(hypotheses).toEqual([]);
  });

  it("real CAN regression: a citation claiming profitable-position + intact-thesis + better-opportunity is excluded when grounding reports it unsupported, and strength is recomputed from what remains", async () => {
    const h = hypothesis(OVERCLAIMING_STATEMENT, [
      {
        interviewAnswerId: "can-answer",
        stance: "supporting",
        description: "מכרת את CAN כי העדפת להשתמש בכסף בחברות אחרות לאחר שהמניה המשיכה לרדת.",
      },
      { interviewAnswerId: "mp-answer", stance: "supporting", description: "Genuinely grounded MP citation." },
    ]);

    const checkGrounding: GroundingCheckFn = async (input) => {
      if (input.sourceAnswerText === REAL_CAN_ANSWER_TEXT && input.hypothesisStatement === OVERCLAIMING_STATEMENT) {
        return {
          verdict: "unsupported",
          reason:
            "The answer describes a declining stock and a missed Nasdaq compliance deadline — not a profitable position with an intact thesis and a specific better opportunity.",
        };
      }
      return { verdict: "supported", reason: "genuinely grounded" };
    };

    const { hypotheses, excluded } = await groundValidatedHypotheses(
      [h],
      new Map([
        ["can-answer", REAL_CAN_ANSWER_TEXT],
        ["mp-answer", "A genuinely grounded MP answer."],
      ]),
      new Map([
        ["can-answer", "CAN#1"],
        ["mp-answer", "MP#1"],
      ]),
      checkGrounding
    );

    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.interviewAnswerId).toBe("can-answer");
    expect(hypotheses).toHaveLength(1);
    // Only the MP citation survives -> 1 independent case, not 2 — CAN's
    // exclusion must not be replaced by any inflated count.
    expect(hypotheses[0]?.supportingCount).toBe(1);
    expect(hypotheses[0]?.evidence.map((e) => e.interviewAnswerId)).toEqual(["mp-answer"]);
  });

  it("fails closed (excludes the citation, does not crash the batch) when the injected grounding check itself throws", async () => {
    const h = hypothesis("Some claim.", [{ interviewAnswerId: "a1", stance: "supporting", description: "x" }]);
    const checkGrounding: GroundingCheckFn = async () => {
      throw new Error("simulated grounding-check failure");
    };

    const { hypotheses, excluded } = await groundValidatedHypotheses(
      [h],
      new Map([["a1", "Some real text."]]),
      new Map([["a1", "TICK#1"]]),
      checkGrounding
    );

    expect(hypotheses).toEqual([]);
    expect(excluded).toHaveLength(1);
  });

  it("fails closed when the source answer text is unavailable at all", async () => {
    const h = hypothesis("Some claim.", [{ interviewAnswerId: "missing", stance: "supporting", description: "x" }]);
    const checkGrounding: GroundingCheckFn = async () => ({ verdict: "supported", reason: "would never be reached" });

    const { hypotheses, excluded } = await groundValidatedHypotheses(
      [h],
      new Map(), // no entry for "missing"
      new Map([["missing", "TICK#1"]]),
      checkGrounding
    );

    expect(hypotheses).toEqual([]);
    expect(excluded[0]?.reason).toContain("failing closed");
  });

  it("preserves correct supporting vs contradicting stance semantics after grounding", async () => {
    const h = hypothesis("Mixed evidence claim.", [
      { interviewAnswerId: "a1", stance: "supporting", description: "for" },
      { interviewAnswerId: "a2", stance: "contradicting", description: "against" },
    ]);
    const checkGrounding: GroundingCheckFn = async () => ({ verdict: "supported", reason: "both genuinely grounded" });

    const { hypotheses } = await groundValidatedHypotheses(
      [h],
      new Map([
        ["a1", "text 1"],
        ["a2", "text 2"],
      ]),
      new Map([
        ["a1", "TICK#1"],
        ["a2", "TICK#2"],
      ]),
      checkGrounding
    );

    expect(hypotheses[0]?.supportingCount).toBe(1);
    expect(hypotheses[0]?.contradictingCount).toBe(1);
  });

  it("a source InterviewAnswer's real text, not the AI-generated description, is what the grounding function receives", async () => {
    let receivedText: string | undefined;
    const h = hypothesis("Some claim.", [
      { interviewAnswerId: "a1", stance: "supporting", description: "A misleading, reframed description." },
    ]);
    const checkGrounding: GroundingCheckFn = async (input) => {
      receivedText = input.sourceAnswerText;
      return { verdict: "supported", reason: "x" };
    };

    await groundValidatedHypotheses(
      [h],
      new Map([["a1", "The real, unedited answer text."]]),
      new Map([["a1", "TICK#1"]]),
      checkGrounding
    );

    expect(receivedText).toBe("The real, unedited answer text.");
    expect(receivedText).not.toContain("misleading");
  });

  it("duplicate descriptions of the same answer cannot manufacture additional support: two citations of the same answer still collapse to one independent case", async () => {
    const h = hypothesis("Some claim.", [
      { interviewAnswerId: "a1", stance: "supporting", description: "Framed one way." },
      { interviewAnswerId: "a1", stance: "supporting", description: "The same fact, framed a different way." },
    ]);
    const checkGrounding: GroundingCheckFn = async () => ({ verdict: "supported", reason: "grounded" });

    const { hypotheses } = await groundValidatedHypotheses(
      [h],
      new Map([["a1", "One real answer."]]),
      new Map([["a1", "TICK#1"]]), // both citations resolve to the SAME case key
      checkGrounding
    );

    expect(hypotheses[0]?.supportingCount).toBe(1);
  });
});
