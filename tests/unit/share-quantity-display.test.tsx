// @vitest-environment jsdom
// Unit 7/D — share quantities display rounded (up to 4 decimals, trailing
// zeros trimmed). Found on the dashboard and the SNDK decision page as
// 0.38589999999999997. Display only; the data passed in stays unrounded.
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { shares } from "@/components/num";
import { HomeView } from "@/components/home/home-view";
import { DecisionView } from "@/components/decision/decision-view";
import type { DecisionViewActions, DecisionViewData } from "@/components/decision/types";
import { loaded } from "@/components/home/types";
import { HOME_PREVIEW } from "@/app/styleguide/home-preview-data";
import { decisionPreviewData } from "@/app/styleguide/decision-preview-data";

const TINY = 0.38589999999999997; // exactly what the dashboard and the SNDK decision page showed

describe("shares()", () => {
  it("rounds to at most 4 decimals and trims trailing zeros", () => {
    expect(String(TINY)).not.toBe("0.3859");
    expect(shares(TINY)).toBe("0.3859");
    expect(shares(12)).toBe("12");
    expect(shares(12.5)).toBe("12.5");
    expect(shares(1.23456789)).toBe("1.2346");
    expect(shares("0.38590000")).toBe("0.3859");
    expect(shares(null)).toBe("?");
  });
});

describe("rendered share quantities", () => {
  it("the dashboard shows the rounded quantity, never the raw float", () => {
    const attention = HOME_PREVIEW.attention.data!;
    const withTiny = attention.items.map((i) => (i.ticker === "ABCD" ? { ...i, position: { ...i.position, quantity: TINY, frozenHoldingQuantity: TINY } } : i));
    const { container } = render(<HomeView data={{ ...HOME_PREVIEW, attention: loaded({ ...attention, items: withTiny, attention: withTiny.filter((i) => i.state === "attention") }) }} />);
    expect(container.textContent).toContain("0.3859");
    expect(container.textContent).not.toContain(String(TINY));
  });

  it("the decision page shows the rounded quantity in the frozen portfolio and today's position", () => {
    const base = decisionPreviewData("reviewed");
    const record = base.record.data!;
    const today = base.today.data!;
    const data = {
      ...base,
      record: loaded({ ...record, snapshot: { ...record.snapshot, portfolioStateJson: { cash: 6400, positions: [{ ticker: "EFGH", quantity: TINY, costBasisPerShare: 210.5 }] } } }),
      today: loaded({ ...today, item: { ...today.item!, position: { ...today.item!.position, quantity: TINY } } }),
    } as DecisionViewData;
    const plain = () => ({ run: vi.fn(), pending: false, error: null });
    const actions = { setReviewDate: plain(), addLaterContext: plain(), runReview: plain(), disagree: plain(), markExecution: plain(), conditions: { resolve: plain(), openCase: plain() } } as unknown as DecisionViewActions;
    const { container } = render(<DecisionView data={data} actions={actions} />);
    expect(container.textContent).toContain("0.3859");
    expect(container.textContent).not.toContain(String(TINY));
  });
});
