// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CaseView } from "@/components/case/case-view";
import { CasesListView } from "@/components/case/cases-list-view";
import { mergeExposure } from "@/components/case/fit-regions";
import { PriorRecordBriefView } from "@/components/prior-record-brief";
import type { CaseAction, CaseViewActions, CaseViewData } from "@/components/case/types";
import { loaded } from "@/components/home/types";
import { caseDetailPage as t, casesListPage, priorRecord, evidenceStrengthLabel, reviewQualityLabel, thesisAccuracyLabel } from "@/lib/i18n/strings";
import { casePreviewData, PRIOR_RECORD_PREVIEW } from "@/app/styleguide/case-preview-data";

// Frontend V1 unit 3 — the Case page and the cases list, rendered with the
// production components on the same synthetic data the /styleguide preview
// uses. No procedure is called: actions are spies.

const spy = <A extends unknown[]>() => ({ run: vi.fn<(...args: A) => void>(), pending: false, error: null }) satisfies CaseAction<A>;
const spies = () => ({ fetchMarket: spy(), computeFit: spy<[number | undefined]>(), personalFit: spy(), reading: spy<[number | undefined]>(), record: spy() }) satisfies CaseViewActions;

function renderCase(data: CaseViewData, actions = spies()) {
  render(<CaseView data={data} actions={actions} />);
  return actions;
}
const region = (id: string) => document.getElementById(id) as HTMLElement;

describe("CaseView — researched case", () => {
  it("renders every region in the approved order, with the AI reading as one region", () => {
    renderCase(casePreviewData("researched"));
    const ids = [...document.querySelectorAll("section[id]")].map((s) => s.id);
    expect(ids).toEqual(["thought", "market", "reading", "portfolio-fit", "personal-fit", "prior-record", "before-recording", "record"]);
    const reading = region("reading");
    const labels = [t.summaryLabel, t.bullCase, t.catalysts, t.bearCase, t.devilsAdvocate, t.invalidationConditions, t.marketBlindspot, t.portfolioFitNarrative];
    const positions = labels.map((l) => reading.textContent!.indexOf(l));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(within(reading).getByText(t.readingProvenance)).toBeTruthy();
    expect(within(reading).getByText(t.regenerateWarning)).toBeTruthy();
  });

  it("shows the fetched-at time of the market data, never 'now'", () => {
    renderCase(casePreviewData("researched"));
    const market = region("market");
    expect(market.textContent).toContain(t.marketProvenancePrefix);
    expect(market.textContent).toContain(new Date("2026-09-29T11:42:00.000Z").toLocaleString("he-IL"));
    expect(within(market).getByRole("button", { name: t.refreshButton })).toBeTruthy();
  });

  it("shows the idea note verbatim with its date", () => {
    renderCase(casePreviewData("researched"));
    const thought = region("thought");
    expect(within(thought).getByText("טקסט דוגמה: המחשבה הראשונה שכתבת על הטיקר, כפי שנכתבה.").tagName).toBe("BLOCKQUOTE");
    expect(thought.textContent).toContain(new Date("2026-09-11T19:30:00.000Z").toLocaleDateString("he-IL"));
  });

  it("Personal Fit with traceable evidence lists each cited item with its identity and Evidence Strength", () => {
    renderCase(casePreviewData("researched"));
    const pf = region("personal-fit");
    expect(pf.textContent).toContain("[DNA]");
    expect(pf.textContent).toContain("[Strategy]");
    expect(within(pf).getByText(evidenceStrengthLabel.moderate!)).toBeTruthy();
    expect(within(pf).getByText(evidenceStrengthLabel.strong!)).toBeTruthy();
    expect(within(pf).queryByText(t.untraceable)).toBeNull();
  });

  it("the computed Portfolio Fit shows totals, the size it used, both exposures and the warnings verbatim", () => {
    renderCase(casePreviewData("researched"));
    const fit = region("portfolio-fit");
    expect(within(fit).getByText(t.computedThisVisit)).toBeTruthy();
    expect(fit.textContent).toContain("$48,250.00");
    expect(fit.textContent).toContain(t.approximateNote);
    expect(fit.textContent).toContain("$3,000.00");
    expect(within(fit).getAllByRole("table")).toHaveLength(2);
    expect(within(fit).getByText("No live price available for IJKL — used cost basis instead.")).toBeTruthy();
    expect(within(fit).getAllByText(t.unclassifiedLabel).length).toBeGreaterThan(0);
  });

  it("the record button stays disabled until reasoning and an explicit horizon exist, then sends the existing payload", () => {
    const actions = renderCase(casePreviewData("researched"));
    const record = region("record");
    const button = within(record).getByRole("button", { name: /רשום/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(record).getByLabelText(new RegExp(t.reasoningLabel)), { target: { value: "  my own words  " } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // Enter in a field never records
    fireEvent.submit(within(record).getByLabelText(new RegExp(t.reasoningLabel)));
    fireEvent.click(within(record).getByLabelText(t.reviewHorizonNoneOption));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(actions.record.run).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(actions.record.run).toHaveBeenCalledWith({
      decisionType: "BUY",
      sizeDollars: undefined,
      reasoningText: "  my own words  ",
      risksConsideredText: undefined,
      exitConditionsText: undefined,
      reviewHorizon: { choice: "none" },
    });
  });
});

describe("CaseView — fresh case", () => {
  it("never computes Portfolio Fit on its own, and says it was not computed in this visit", () => {
    const actions = renderCase(casePreviewData("fresh"));
    const fit = region("portfolio-fit");
    expect(within(fit).getByText(t.notComputedThisVisit)).toBeTruthy();
    expect(within(fit).getByText(t.fitNeedsMarket)).toBeTruthy();
    expect(actions.computeFit.run).not.toHaveBeenCalled();
    expect(Object.values(actions).every((a) => a.run.mock.calls.length === 0)).toBe(true);
  });

  it("shows honest empty states for a directly opened case with no market data", () => {
    renderCase(casePreviewData("fresh"));
    expect(within(region("thought")).getByText(t.thoughtEmptyTitle)).toBeTruthy();
    expect(within(region("market")).getByText(t.marketEmptyTitle)).toBeTruthy();
    expect(within(region("reading")).getByText(t.readingEmptyTitle)).toBeTruthy();
    expect(within(region("personal-fit")).getByText(t.personalFitEmptyTitle)).toBeTruthy();
    expect(within(region("prior-record")).getByText(priorRecord.empty)).toBeTruthy();
    // generating needs market data first
    expect((within(region("reading")).getByRole("button", { name: t.generateReading }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("'לפני הרישום' lists the missing Strategy and every undone step, with no score", () => {
    const actions = renderCase(casePreviewData("fresh"));
    const h = region("before-recording");
    expect(h.textContent).toContain(t.rule.strategy);
    expect(h.textContent).toContain(t.ruleStrategyMissingHint);
    expect(h.textContent).toContain(t.freshAtRecord);
    expect(h.textContent).toContain(t.readinessHint);
    expect(h.textContent).not.toMatch(/%|\/\s*\d/);
    for (const k of ["market", "portfolioFit", "personalFit", "reading"]) expect(h.textContent).toContain(t.inventory[k]);
    fireEvent.click(within(h).getByRole("button", { name: t.fetchButton }));
    expect(actions.fetchMarket.run).toHaveBeenCalledTimes(1);
  });
});

describe("CaseView — decided case", () => {
  it("is read-only: the decision link and frozen note, no refresh or generate actions, no readiness or form", () => {
    renderCase(casePreviewData("decided"));
    expect(screen.getAllByRole("link", { name: t.openDecision }).length).toBe(2);
    expect(screen.getByText(t.decidedFrozenNote)).toBeTruthy();
    expect(region("before-recording")).toBeNull();
    for (const name of [t.refreshButton, t.regenerateReading, t.regeneratePersonalFit, t.computeFitButton]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("button", { name: /רשום/ })).toBeNull();
    expect(within(region("portfolio-fit")).getByText(t.decidedFitNote)).toBeTruthy();
  });

  it("an untraceable Personal Fit reads as Insufficient Evidence, not as a finding", () => {
    renderCase(casePreviewData("decided"));
    const pf = region("personal-fit");
    expect(within(pf).getByText(evidenceStrengthLabel.insufficient_evidence!)).toBeTruthy();
    expect(within(pf).getByText(t.untraceable)).toBeTruthy();
    expect(within(pf).queryByText(t.citedTitle)).toBeNull();
  });
});

describe("CaseView — original thought from a condition, and page states", () => {
  it("shows the confirmed condition in the investor's words with a link to the original decision", () => {
    const data = casePreviewData("fresh");
    data.origin = loaded({ claimText: "טענת תנאי לדוגמה", decisionId: "dec-x", decisionType: "PASS", decisionDate: "2026-02-01T00:00:00.000Z", ticker: "ABCD", resolutionNote: "הערת פתרון לדוגמה" });
    renderCase(data);
    const thought = region("thought");
    expect(within(thought).getByText("טענת תנאי לדוגמה").tagName).toBe("BLOCKQUOTE");
    expect(within(thought).getByText("הערת פתרון לדוגמה")).toBeTruthy();
    expect(within(thought).getByRole("link", { name: t.originOpenDecision }).getAttribute("href")).toBe("/decisions/dec-x");
    expect(within(thought).queryByText(t.thoughtEmptyTitle)).toBeNull();
  });

  it("loading and failure of the case itself", () => {
    const data = casePreviewData("fresh");
    const { unmount } = render(<CaseView data={{ ...data, investmentCase: { data: undefined, isLoading: true, isError: false } }} actions={spies()} />);
    expect(screen.getByRole("status")).toBeTruthy();
    unmount();
    render(<CaseView data={{ ...data, investmentCase: { data: undefined, isLoading: false, isError: true, error: { message: "Investment case not found." } } }} actions={spies()} />);
    expect(screen.getByRole("alert").textContent).toContain("Investment case not found.");
  });
});

describe("PriorRecordBriefView — shared presentation", () => {
  it("live: facts, open conditions, decisions collapsed by default, a neutral Review label and its note, no tally", () => {
    const { container } = render(<PriorRecordBriefView brief={PRIOR_RECORD_PREVIEW} />);
    expect(container.textContent).toContain(priorRecord.liveNote);
    expect(container.textContent).toContain(priorRecord.reentryTitle);
    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(1);
    expect(details[0]!.open).toBe(false);
    // Review verdicts through the display labels, never the raw enum values
    const badge = within(container).getByText(/Review ·/);
    expect(badge.textContent).toContain(`${priorRecord.reviewQualityPrefix} ${reviewQualityLabel.reasonable}`);
    expect(badge.textContent).toContain(`${priorRecord.thesisAccuracyPrefix} ${thesisAccuracyLabel.insufficient_evidence}`);
    expect(container.textContent).not.toMatch(/insufficient_evidence|reasonable|partially_confirmed/);
    expect(container.querySelector(".bg-positive-soft, .bg-negative-soft, .text-positive, .text-negative")).toBeNull();
    expect(container.textContent).toContain(priorRecord.reviewLabelsNote);
    expect(within(container).getByRole("link", { name: priorRecord.openPastDecision }).getAttribute("href")).toBe("/decisions/dec-prev-1");
    // the investor's frozen words, verbatim with their line break
    const quote = [...container.querySelectorAll("blockquote")].find((b) => b.textContent!.startsWith("טקסט דוגמה: הנימוק שנכתב"));
    expect(quote?.textContent).toBe("טקסט דוגמה: הנימוק שנכתב בזמן ההחלטה הקודמת, מילה במילה.\nשורה שנייה של אותו נימוק.");
  });

  it("an unknown Review value is shown as a dash, never as raw text", () => {
    const d = PRIOR_RECORD_PREVIEW.decisions[0]!;
    const brief = { ...PRIOR_RECORD_PREVIEW, decisions: [{ ...d, latestReview: { ...d.latestReview!, decisionQualityOverall: "some_new_value", thesisAccuracy: "another_value" } }] };
    const { container } = render(<PriorRecordBriefView brief={brief} />);
    expect(container.textContent).not.toMatch(/some_new_value|another_value/);
    expect(within(container).getByText(/Review ·/).textContent).toContain("—");
  });

  it("frozen: says it was frozen with the decision", () => {
    const { container } = render(<PriorRecordBriefView brief={PRIOR_RECORD_PREVIEW} frozen />);
    expect(container.textContent).toContain(priorRecord.frozenNote);
    expect(container.textContent).not.toContain(priorRecord.liveNote);
  });
});

describe("mergeExposure", () => {
  it("joins current and projected per bucket, keeps the unclassified bucket, sorts by current weight", () => {
    const rows = mergeExposure(
      [
        { label: "B", w: 10 },
        { label: null, w: 30 },
        { label: "A", w: 20 },
      ],
      [
        { label: "A", w: 25 },
        { label: "C", w: 5 },
      ]
    );
    expect(rows).toEqual([
      { label: null, current: 30, projected: null },
      { label: "A", current: 20, projected: 25 },
      { label: "B", current: 10, projected: null },
      { label: "C", current: null, projected: 5 },
    ]);
  });
});

describe("CasesListView", () => {
  const create = () => spy<[string]>();
  it("empty: an honest empty state and the create form", () => {
    render(<CasesListView cases={loaded([])} stalledCaseIds={new Set()} create={create()} />);
    expect(screen.getByText(casesListPage.emptyTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: casesListPage.createButton })).toBeTruthy();
  });

  it("populated: ticker, status, dates and the stalled flag from next actions; create sends the typed ticker", () => {
    const c = create();
    render(
      <CasesListView
        cases={loaded([
          { id: "c1", ticker: "ABCD", status: "researching", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" },
          { id: "c2", ticker: "EFGH", status: "decided", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z" },
        ])}
        stalledCaseIds={new Set(["c1"])}
        create={c}
      />
    );
    const rows = within(screen.getByRole("list", { name: casesListPage.listLabel })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(casesListPage.stalled)).toBeTruthy();
    expect(within(rows[1]!).queryByText(casesListPage.stalled)).toBeNull();
    expect(within(rows[1]!).getByRole("link", { name: casesListPage.openCase }).getAttribute("href")).toBe("/cases/c2");
    fireEvent.change(screen.getByLabelText(casesListPage.tickerLabel), { target: { value: "wxyz" } });
    fireEvent.click(screen.getByRole("button", { name: casesListPage.createButton }));
    expect(c.run).toHaveBeenCalledWith("wxyz");
  });
});
