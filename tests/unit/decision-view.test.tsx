// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { DecisionView } from "@/components/decision/decision-view";
import { DecisionsListView } from "@/components/decision/decisions-list-view";
import { statusLabel } from "@/components/decision/predictions-region";
import type { DecisionAction, DecisionViewActions, DecisionViewData } from "@/components/decision/types";
import { loaded } from "@/components/home/types";
import { Quote, Provenance } from "@/components/ui/quote";
import {
  citedFieldLabel,
  decisionPage as t,
  decisionsListPage,
  priorRecord,
  reentryCondition,
  reviewDimensionLabel,
  reviewQualityLabel,
  thesisAccuracyLabel,
} from "@/lib/i18n/strings";
import { decisionPreviewData } from "@/app/styleguide/decision-preview-data";
import { decisionQualityEnum, thesisAccuracyEnum, reviewDimensionNameEnum } from "@/db/schema/enums";
import { CITABLE_SNAPSHOT_FIELDS } from "@/lib/review/validate-review-dimensions";

// Frontend V1 unit 4 — the Decision record and Review, rendered with the
// production components on the same synthetic data the /styleguide preview
// uses. Actions are spies; no procedure is called.

const spyAction = <A extends unknown[]>(result = true) => ({ run: vi.fn<(...args: A) => Promise<boolean>>(async () => result), pending: false, error: null }) satisfies DecisionAction<A>;
const plain = () => ({ run: vi.fn(), pending: false, error: null });
const spies = () =>
  ({
    setReviewDate: spyAction<[string]>(),
    addLaterContext: spyAction<[string]>(),
    runReview: spyAction<[never[]]>(),
    disagree: spyAction<[string, string]>(),
    markExecution: plain(),
    conditions: { resolve: plain(), openCase: plain() },
  }) as unknown as DecisionViewActions & {
    runReview: ReturnType<typeof spyAction>;
    disagree: ReturnType<typeof spyAction>;
    addLaterContext: ReturnType<typeof spyAction>;
  };

function renderDecision(data: DecisionViewData, actions = spies()) {
  const view = render(<DecisionView data={data} actions={actions} />);
  return { actions, ...view };
}
const region = (id: string) => document.getElementById(id) as HTMLElement;
const RAW_ENUMS = [...decisionQualityEnum.enumValues, ...thesisAccuracyEnum.enumValues, ...reviewDimensionNameEnum.enumValues, ...CITABLE_SNAPSHOT_FIELDS, "priorRecord", "executionFacts"];

describe("DecisionView — temporal separation", () => {
  it("names each time band in words, with the frozen record, today and since as separate regions", () => {
    renderDecision(decisionPreviewData("reviewed"));
    expect(within(region("then")).getByText(t.thenTitle)).toBeTruthy();
    expect(within(region("today")).getByText(t.todayTitle)).toBeTruthy();
    expect(within(region("since")).getByText(t.sinceTitle)).toBeTruthy();
    // later context lives in SINCE, never inside the frozen record
    expect(region("then").textContent).not.toContain("טקסט דוגמה: הקשר שהוספתי אחרי ההחלטה.");
    expect(region("since").textContent).toContain("טקסט דוגמה: הקשר שהוספתי אחרי ההחלטה.");
    // the frozen record has no live facts
    expect(region("then").textContent).not.toContain(t.heldPrefix);
    expect(region("then").textContent).toContain(priorRecord.heldAtDecisionPrefix);
  });

  it("renders the investor's reasoning verbatim, line break included, before the AI's words", () => {
    renderDecision(decisionPreviewData("reviewed"));
    const then = region("then");
    const quote = [...then.querySelectorAll("blockquote")].find((b) => b.textContent!.startsWith("טקסט דוגמה: הנימוק"));
    expect(quote?.textContent).toBe("טקסט דוגמה: הנימוק שנכתב ברגע ההחלטה, מילה במילה.\nשורה שנייה: מה אני מצפה שיקרה, ולמה עכשיו.");
    const text = then.textContent!;
    expect(text.indexOf(t.reasoningLabel)).toBeLessThan(text.indexOf(t.aiAtRecordTitle));
    expect(within(then).getByText(t.aiAtRecordNote)).toBeTruthy();
    expect(within(then).getByText(t.statementsNote)).toBeTruthy();
  });

  it("frozen context: portfolio, market context with capture time, DNA tiers then, Strategy status without its principles, frozen Prior Record", () => {
    renderDecision(decisionPreviewData("reviewed"));
    const then = region("then");
    expect(then.textContent).toContain(t.capturedPrefix);
    expect(then.textContent).toContain(new Date("2026-09-12T09:10:00.000Z").toLocaleString("he-IL"));
    expect(then.textContent).toContain("נוטה להוסיף לפוזיציה קיימת אחרי ירידה.");
    expect(then.textContent).toContain(t.strategyIsCurrent);
    expect(then.textContent).toContain(t.strategyLimitation);
    expect(then.textContent).toContain(priorRecord.frozenNote);
    expect(then.textContent).not.toContain(priorRecord.liveNote);
  });

  it("a newer Strategy version is said as such, and an unknown one is not guessed", () => {
    const newer = decisionPreviewData("reviewed");
    newer.currentStrategyVersionId = loaded("strategy-v9");
    const { unmount } = renderDecision(newer);
    expect(region("then").textContent).toContain(t.strategyIsOlder);
    unmount();
    const unknown = decisionPreviewData("reviewed");
    unknown.currentStrategyVersionId = { data: undefined, isLoading: false, isError: true, error: { message: "x" } };
    renderDecision(unknown);
    expect(region("then").textContent).toContain(t.strategyUnknown);
  });

  it("backdated: both dates in the header and a note that the frozen context is from recording", () => {
    renderDecision(decisionPreviewData("backdated"));
    const header = document.querySelector("header")!;
    expect(header.textContent).toContain(t.decidedOnPrefix + new Date("2026-08-30T00:00:00.000Z").toLocaleDateString("he-IL"));
    expect(header.textContent).toContain(t.recordedOnPrefix + new Date("2026-09-12T09:30:00.000Z").toLocaleDateString("he-IL"));
    expect(screen.getByText(t.backdatedNote)).toBeTruthy();
  });

  it("same-day recording shows no recorded-on date and no backdated note", () => {
    renderDecision(decisionPreviewData("reviewed"));
    expect(document.querySelector("header")!.textContent).not.toContain(t.recordedOnPrefix);
    expect(screen.queryByText(t.backdatedNote)).toBeNull();
  });
});

describe("DecisionView — legacy and empty states", () => {
  it("legacy: no Prior Record frozen shows the historical absence, never a live brief; no horizon offers set-once", () => {
    renderDecision(decisionPreviewData("legacy"));
    expect(region("then").textContent).toContain(priorRecord.legacyNote);
    expect(region("then").textContent).not.toContain(priorRecord.liveNote);
    expect(screen.getByText(t.noReviewDate)).toBeTruthy();
    expect(screen.getByRole("button", { name: t.setReviewDateButton })).toBeTruthy();
    expect(region("today").textContent).toContain(t.settled);
  });

  it("a decision without a snapshot is a named absence, not an error", () => {
    const data = decisionPreviewData("reviewed");
    data.record = loaded({ ...data.record.data!, snapshot: null, predictions: [], marketContext: null });
    renderDecision(data);
    expect(screen.getByText(t.noSnapshotTitle)).toBeTruthy();
    expect(region("review")).toBeNull();
  });

  it("loading and a failed load", () => {
    const data = decisionPreviewData("reviewed");
    const { unmount } = renderDecision({ ...data, record: { data: undefined, isLoading: true, isError: false } });
    expect(screen.getByRole("status")).toBeTruthy();
    unmount();
    renderDecision({ ...data, record: { data: undefined, isLoading: false, isError: true, error: { message: "Decision not found." } } });
    expect(screen.getByRole("alert").textContent).toContain("Decision not found.");
  });
});

describe("DecisionView — today and since", () => {
  it("today shows horizon status, due and open predictions, position and history — no price", () => {
    renderDecision(decisionPreviewData("reviewed"));
    const today = region("today").textContent!;
    expect(today).toContain(t.horizon.upcoming);
    expect(today).toContain(t.predictionsDueSuffix);
    expect(today).toContain(t.pendingSuffix);
    expect(today).toContain(t.heldPrefix);
    expect(today).toContain(t.historyThroughPrefix);
    // a holding fact, never a live price, P&L or outcome
    for (const label of [t.outcomePriceAtReview, t.outcomePnl, t.outcomeChange, t.priceAtRecordLabel]) expect(today).not.toContain(label);
  });

  it("later context is added through the existing action and the draft clears only on success", async () => {
    const { actions } = renderDecision(decisionPreviewData("reviewed"));
    const box = within(region("later-context")).getByLabelText(t.laterContextLabel) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "new note" } });
    fireEvent.click(within(region("later-context")).getByRole("button", { name: t.addContextButton }));
    expect(actions.addLaterContext.run).toHaveBeenCalledWith("new note");
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("execution: the executed fact and a candidate with the existing marks", () => {
    renderDecision(decisionPreviewData("reviewed"));
    const ex = region("execution");
    expect(ex.textContent).toContain("טקסט דוגמה: הערה על הביצוע.");
    expect(within(ex).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
  });
});

describe("DecisionView — predictions", () => {
  it("each row keeps the THEN claim apart from what was determined since", () => {
    renderDecision(decisionPreviewData("reviewed"));
    const rows = within(region("predictions")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain(t.thenColumn);
    expect(rows[0]!.textContent).toContain(t.sinceColumn);
    expect(rows[0]!.textContent).toContain(t.resolvedInReview);
    // a pending condition is still open, with its own resolution controls
    expect(rows[2]!.textContent).toContain(t.stillOpen);
    expect(within(rows[2]!).getByRole("button", { name: reentryCondition.submitButton })).toBeTruthy();
  });

  it("a condition is resolved in its own words; a forecast in forecast words; a legacy kind is not invented", () => {
    expect(statusLabel({ kind: "reentry_condition", status: "confirmed" })).toBe(reentryCondition.fired);
    expect(statusLabel({ kind: "reentry_condition", status: "refuted" })).toBe(reentryCondition.notFired);
    expect(statusLabel({ kind: "forecast", status: "refuted" })).not.toBe(reentryCondition.notFired);
    expect(statusLabel({ kind: null, status: "pending" })).toBe(t.stillOpen);
    renderDecision(decisionPreviewData("legacy"));
    const row = within(region("predictions")).getAllByRole("listitem")[0]!;
    expect(row.textContent).not.toMatch(/תחזית|תנאי לשקילה/);
  });

  it("a prediction without a check date says so and is never due", () => {
    renderDecision(decisionPreviewData("fresh"));
    const rows = within(region("predictions")).getAllByRole("listitem");
    expect(rows[1]!.textContent).toContain(t.noCheckDate);
    expect(region("today").textContent).not.toContain(t.predictionsDueSuffix);
  });

  it("a confirmed condition links to the case already opened from it", () => {
    renderDecision(decisionPreviewData("pass"));
    const row = within(region("predictions")).getAllByRole("listitem")[0]!;
    expect(within(row).getByRole("link", { name: reentryCondition.openReconsiderationCase }).getAttribute("href")).toBe("/cases/case-reconsider");
  });
});

describe("DecisionView — Review", () => {
  it("no Review yet: an honest state; every pending prediction must be resolved before the existing submission", async () => {
    const { actions } = renderDecision(decisionPreviewData("fresh"));
    const review = region("review");
    expect(within(review).getByText(t.noReviewTitle)).toBeTruthy();
    const run = within(review).getByRole("button", { name: t.runReview }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    // both the forecast and the condition are listed: reviews.generate refuses while any prediction is pending
    const groups = within(review).getAllByRole("radiogroup");
    expect(groups).toHaveLength(2);
    fireEvent.click(within(groups[0]!).getAllByRole("button")[0]!);
    fireEvent.click(within(groups[1]!).getByRole("button", { name: reentryCondition.notFired }));
    const notes = within(review).getAllByLabelText(t.resolutionNoteLabel);
    fireEvent.change(notes[0]!, { target: { value: " a " } });
    expect(run.disabled).toBe(true);
    fireEvent.change(notes[1]!, { target: { value: "b" } });
    expect(run.disabled).toBe(false);
    fireEvent.click(run);
    expect(actions.runReview.run).toHaveBeenCalledWith([
      { predictionId: "p-1", status: "confirmed", note: "a" },
      { predictionId: "p-2", status: "refuted", note: "b" },
    ]);
  });

  it("multiple Reviews: newest open first, older collapsed; three separate axes through the display maps", () => {
    renderDecision(decisionPreviewData("reviewed"));
    const review = region("review");
    const cards = review.querySelectorAll("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain(t.latestReview);
    expect(cards[1]!.closest("details")?.open).toBe(false);
    const latest = cards[0]!.textContent!;
    expect(latest).toContain(`${t.axisQuality}${reviewQualityLabel.reasonable}`);
    expect(latest).toContain(`${t.axisAccuracy}${thesisAccuracyLabel.partially_confirmed}`);
    expect(latest).toContain(t.axisOutcomePrefix + new Date("2026-09-28T18:00:00.000Z").toLocaleDateString("he-IL"));
    expect(latest).toContain(t.axesNote);
    expect(latest).toContain(t.reviewLanguageNote);
  });

  it("dimensions and citations use display labels, and no raw Review value is rendered anywhere", () => {
    const { container } = renderDecision(decisionPreviewData("reviewed"));
    const latest = region("review").querySelector("article")!;
    expect(latest.textContent).toContain(reviewDimensionLabel.valuation_awareness);
    expect(latest.textContent).toContain(citedFieldLabel.userReasoningText);
    expect(latest.textContent).toContain(citedFieldLabel.caseBullCaseText);
    expect(latest.textContent).toContain(t.noCitations);
    // every text node, not the English rationale sentences, is free of stored identifiers
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: string[] = [];
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement!;
      if (el.closest("[lang=en]")) continue;
      nodes.push(walker.currentNode.textContent!);
    }
    const text = nodes.join(" ");
    for (const raw of RAW_ENUMS) expect(text, raw).not.toMatch(new RegExp(`\\b${raw}\\b`));
  });

  it("verdicts are neutral: no success or failure color on any Review badge", () => {
    renderDecision(decisionPreviewData("reviewed"));
    expect(region("review").querySelector(".bg-positive-soft, .bg-negative-soft, .bg-caution-soft, .text-positive, .text-negative")).toBeNull();
  });

  it("PASS: the outcome stays behind an explicit reveal", () => {
    renderDecision(decisionPreviewData("pass"));
    const latest = region("review").querySelector("article")!;
    expect(latest.textContent).not.toContain(t.outcomePriceAtReview);
    fireEvent.click(within(latest).getByRole("button", { name: t.passRevealShow }));
    expect(latest.textContent).toContain(t.outcomePriceAtReview);
    expect(latest.textContent).toContain(t.passRevealNote);
  });

  it("disagreeing uses the existing write and then says the objection cannot be read back", async () => {
    const { actions } = renderDecision(decisionPreviewData("reviewed"));
    const latest = region("review").querySelector("article")!;
    fireEvent.click(within(latest).getAllByRole("button", { name: t.disagreeButton })[0]!);
    fireEvent.change(within(latest).getByLabelText(t.disagreeLabel), { target: { value: "I disagree" } });
    fireEvent.click(within(latest).getByRole("button", { name: t.disagreeSubmit }));
    expect(actions.disagree.run).toHaveBeenCalledWith(expect.stringContaining("dim-thesis_quality"), "I disagree");
    await waitFor(() => expect(within(latest).getByText(t.disagreeSaved)).toBeTruthy());
  });
});

describe("DecisionsListView", () => {
  it("empty and populated", () => {
    const { unmount } = render(<DecisionsListView decisions={loaded([])} />);
    expect(screen.getByText(decisionsListPage.noDecisionsYet)).toBeTruthy();
    unmount();
    render(
      <DecisionsListView
        decisions={loaded([
          { id: "d1", ticker: "ABCD", decisionType: "BUY", decisionDate: "2026-09-12T00:00:00.000Z", reviewByDate: null },
          { id: "d2", ticker: "EFGH", decisionType: "PASS", decisionDate: "2026-08-01T00:00:00.000Z", reviewByDate: "2026-12-01T00:00:00.000Z" },
        ])}
      />
    );
    const rows = within(screen.getByRole("list", { name: decisionsListPage.listLabel })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain(t.noReviewDate);
    expect(rows[1]!.textContent).toContain(t.reviewByPrefix);
    expect(within(rows[1]!).getByRole("link", { name: decisionsListPage.openDecision }).getAttribute("href")).toBe("/decisions/d2");
  });
});

describe("Shared Quote and Provenance", () => {
  it("render exactly the classes Case used before the move", () => {
    const { container } = render(
      <>
        <Quote>words</Quote>
        <Provenance>source</Provenance>
      </>
    );
    expect(container.querySelector("blockquote")!.className).toBe("whitespace-pre-wrap border-s-2 border-rule-strong ps-4 text-sm leading-relaxed text-ink");
    expect(container.querySelector("p")!.className).toBe("max-w-[65ch] text-xs leading-relaxed text-muted");
  });
});
