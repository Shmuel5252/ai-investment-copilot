import { describe, expect, it } from "vitest";
import { deriveReadiness, isHorizonChosen, type ReadinessInput } from "@/components/case/derive-readiness";

// Frontend V1 unit 3 — "לפני הרישום" is a plain derivation over existing
// state: four rules that mirror decisions.create, four inventory rows, no
// score. Every rule state and every inventory combination is pinned here.

const base: ReadinessInput = {
  status: "researching",
  hasApprovedStrategy: true,
  reasoningText: "because",
  reviewHorizon: "none",
  reviewByDate: "",
  marketFetched: false,
  fitComputedThisVisit: false,
  personalFitGenerated: false,
  readingGenerated: false,
};
const rule = (input: Partial<ReadinessInput>, key: string) => deriveReadiness({ ...base, ...input }).rules.find((r) => r.key === key)!.state;

describe("deriveReadiness — rules", () => {
  it("lists exactly the four server prerequisites, in order, and nothing that looks like a score", () => {
    const r = deriveReadiness(base);
    expect(r.rules.map((x) => x.key)).toEqual(["researching", "strategy", "reasoning", "horizon"]);
    expect(Object.keys(r).sort()).toEqual(["formComplete", "inventory", "rules"]);
  });

  it("researching: met only for status researching", () => {
    expect(rule({ status: "researching" }, "researching")).toBe("met");
    expect(rule({ status: "decided" }, "researching")).toBe("unmet");
    expect(rule({ status: "archived" }, "researching")).toBe("unmet");
  });

  it("strategy: met, unmet, or unknown while not known — never guessed", () => {
    expect(rule({ hasApprovedStrategy: true }, "strategy")).toBe("met");
    expect(rule({ hasApprovedStrategy: false }, "strategy")).toBe("unmet");
    expect(rule({ hasApprovedStrategy: undefined }, "strategy")).toBe("unknown");
  });

  it("reasoning: whitespace is not reasoning", () => {
    expect(rule({ reasoningText: "x" }, "reasoning")).toBe("met");
    expect(rule({ reasoningText: "" }, "reasoning")).toBe("unmet");
    expect(rule({ reasoningText: "  \n " }, "reasoning")).toBe("unmet");
  });

  it("horizon: an explicit choice only; 'date' without a date is not a choice", () => {
    expect(rule({ reviewHorizon: "", reviewByDate: "" }, "horizon")).toBe("unmet");
    expect(rule({ reviewHorizon: "", reviewByDate: "2026-12-01" }, "horizon")).toBe("unmet");
    expect(rule({ reviewHorizon: "date", reviewByDate: "" }, "horizon")).toBe("unmet");
    expect(rule({ reviewHorizon: "date", reviewByDate: "2026-12-01" }, "horizon")).toBe("met");
    expect(rule({ reviewHorizon: "none", reviewByDate: "" }, "horizon")).toBe("met");
    expect(isHorizonChosen("none", "2026-12-01")).toBe(true);
  });

  it("formComplete is exactly reasoning AND horizon — the record button's existing test", () => {
    for (const reasoningText of ["", "x"])
      for (const [reviewHorizon, reviewByDate] of [["", ""], ["date", ""], ["date", "2026-12-01"], ["none", ""]] as const) {
        const r = deriveReadiness({ ...base, reasoningText, reviewHorizon, reviewByDate });
        expect(r.formComplete, `${reasoningText}/${reviewHorizon}/${reviewByDate}`).toBe(reasoningText !== "" && (reviewHorizon === "none" || reviewByDate !== ""));
      }
    // status and strategy are shown, not folded into the form test (the server still enforces them)
    expect(deriveReadiness({ ...base, status: "decided", hasApprovedStrategy: false }).formComplete).toBe(true);
  });
});

describe("deriveReadiness — research inventory", () => {
  it("reports each of the four steps as done or not, for all 16 combinations", () => {
    for (let mask = 0; mask < 16; mask++) {
      const flags = { marketFetched: !!(mask & 1), fitComputedThisVisit: !!(mask & 2), personalFitGenerated: !!(mask & 4), readingGenerated: !!(mask & 8) };
      const r = deriveReadiness({ ...base, ...flags });
      expect(r.inventory).toEqual([
        { key: "market", done: flags.marketFetched },
        { key: "portfolioFit", done: flags.fitComputedThisVisit },
        { key: "personalFit", done: flags.personalFitGenerated },
        { key: "reading", done: flags.readingGenerated },
      ]);
      // the inventory never affects the rules
      expect(r.rules).toEqual(deriveReadiness(base).rules);
    }
  });
});
