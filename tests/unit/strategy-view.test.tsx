// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { StrategyView, byType, newerThanApproval, type StrategyActions } from "@/components/strategy/strategy-view";
import { EvidenceList } from "@/components/claims/evidence-disclosure";
import { loaded } from "@/components/home/types";
import { evidenceStrengthLabel, principleCreatedByLabel, strategyPage as t, dnaPage } from "@/lib/i18n/strings";
import { strategyPreviewData, STRATEGY_PREVIEW_CANDIDATES, STRATEGY_PREVIEW_EVIDENCE, APPROVED } from "@/app/styleguide/strategy-preview-data";
import { DNA_PREVIEW_DECISIONS } from "@/app/styleguide/dna-preview-data";
import { principleCreatedByEnum, principleTypeEnum, evidenceStrengthEnum } from "@/db/schema/enums";

// Frontend V1 unit 6B — the Strategy page, rendered with the production
// components on the same synthetic data the /styleguide preview uses.
// Actions are spies; no procedure and no AI is called.

function actions(over: Partial<{ [K in keyof StrategyActions]: Partial<StrategyActions[K]> }> = {}) {
  return {
    approve: { run: vi.fn(async () => true), pending: false, error: null, approvedVersionNumber: null, ...over.approve },
    propose: { run: vi.fn(), pending: false, error: null, candidates: null, runId: 0, ...over.propose },
    confirm: { run: vi.fn(async () => true), pendingIndex: null, error: null, ...over.confirm },
    generate: { run: vi.fn(), pending: false, error: null, result: null, ...over.generate },
  } as unknown as StrategyActions & {
    approve: { run: ReturnType<typeof vi.fn> };
    propose: { run: ReturnType<typeof vi.fn> };
    confirm: { run: ReturnType<typeof vi.fn> };
    generate: { run: ReturnType<typeof vi.fn> };
  };
}
function renderStrategy(state: "main" | "flow" | "sparse" = "main", a = actions()) {
  const d = strategyPreviewData(state);
  if (state === "flow" && a.propose.candidates === null) a.propose.candidates = d.candidates;
  const view = render(
    <StrategyView
      strategy={d.strategy}
      reach={d.reach}
      actions={a}
      renderEvidence={(id) => <EvidenceList evidence={loaded(STRATEGY_PREVIEW_EVIDENCE[id] ?? [])} decisions={DNA_PREVIEW_DECISIONS} />}
    />
  );
  return { a, ...view };
}
const region = (id: string) => document.getElementById(id) as HTMLElement;
const rows = (id: string) => within(within(region(id)).getByRole("list")).getAllByRole("listitem").filter((li) => li.closest("ul") === region(id).querySelector("ul"));
const openEvidence = (row: HTMLElement) => {
  const details = row.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
};

describe("three kinds of principle", () => {
  it("split by type in the order strategy.list returns", () => {
    const d = strategyPreviewData("main").strategy.data!;
    const g = byType(d.principles);
    expect(g.declared.map((p) => p.id)).toEqual(["p-d1", "p-d2"]);
    expect(g.validated.map((p) => p.id)).toEqual(["p-v1", "p-v2"]);
    expect(g.observed.map((p) => p.id)).toEqual(["p-o1", "p-o2"]);
  });

  it("declared: the adopted wording quoted with its rationale, and no evidence tier", () => {
    renderStrategy();
    const first = rows("declared")[0]!;
    expect(first.querySelector("blockquote")!.textContent).toBe("טקסט דוגמה: לא להוסיף לפוזיציה בלי לבדוק מחדש את התזה.");
    expect(first.textContent).toContain("טקסט דוגמה: הנימוק שנשמר עם העיקרון.");
    expect(first.textContent).toContain(t.declaredOrigin);
    for (const tier of evidenceStrengthEnum.enumValues) expect(first.textContent).not.toContain(evidenceStrengthLabel[tier]!);
    expect(region("declared").textContent).toContain(t.declaredHint);
  });

  it("validated: a system guardrail, not quoted as the investor's words, no tier", () => {
    renderStrategy();
    expect(region("validated").textContent).toContain(t.validatedHint);
    const first = rows("validated")[0]!;
    expect(first.querySelector("blockquote")).toBeNull();
    expect(first.textContent).toContain(t.validatedOrigin);
    expect(first.textContent).not.toContain(evidenceStrengthLabel.insufficient_evidence!);
  });

  it("observed: said to be a system observation, not a chosen principle, with the claims-layer row", () => {
    renderStrategy();
    expect(region("observed").textContent).toContain(t.observedHint);
    const first = rows("observed")[0]!;
    expect(within(first).getByText(evidenceStrengthLabel.insufficient_evidence!)).toBeTruthy();
    expect(first.textContent).toContain(`2 ${dnaPage.supportingCasesSuffix}`);
    expect(first.textContent).toContain(`1 ${dnaPage.contradictingSuffix}`);
    expect(first.textContent).toContain(`3 ${dnaPage.citedSuffix}`);
    expect(first.textContent).toContain(dnaPage.notUsedByAi);
    expect(within(first).queryByRole("button", { name: dnaPage.rejectButton })).toBeNull();
  });

  it("observed evidence: supporting and contradicting citations, labeled AI summaries, the version origin", () => {
    renderStrategy();
    const first = rows("observed")[0]!;
    openEvidence(first);
    expect(first.textContent).toContain(principleCreatedByLabel.system_grounding_revalidation);
    const cites = within(within(first).getByRole("list", { name: dnaPage.citationsTitle })).getAllByRole("listitem");
    expect(cites).toHaveLength(3);
    expect(cites[0]!.textContent).toContain("תומך");
    expect(cites[2]!.textContent).toContain("סותר");
    for (const c of cites) expect(c.textContent).toContain(dnaPage.aiSummaryLabel);
  });

  it("observed with no provenance says so", () => {
    renderStrategy();
    const second = rows("observed")[1]!;
    openEvidence(second);
    expect(second.textContent).toContain(dnaPage.provenanceMissing);
    expect(second.textContent).toContain(dnaPage.basisMissing);
  });
});

describe("approved version and drift", () => {
  it("shows the approved version as a record: number, date, the investor's summary quoted, the freeze note", () => {
    renderStrategy();
    const card = region("approved");
    expect(card.textContent).toContain(`${t.approvedVersionPrefix} 2`);
    expect(card.textContent).toContain(t.approvedOnPrefix + new Date(APPROVED.createdAt).toLocaleDateString("he-IL"));
    expect(card.querySelector("blockquote")!.textContent).toBe(APPROVED.changeSummary);
    expect(card.textContent).toContain(t.approvedFrozenNote);
    expect(card.textContent).toContain(t.historyNote);
  });

  it("drift counts only current versions created after the approval, and marks exactly those rows", () => {
    const d = strategyPreviewData("main").strategy.data!;
    expect([...newerThanApproval(d.principles, APPROVED)].sort()).toEqual(["p-d2", "p-o1"]);
    expect(newerThanApproval(d.principles, null).size).toBe(0);
    renderStrategy();
    expect(region("approved").textContent).toContain(`2 ${t.driftMiddle}`);
    expect(rows("declared")[1]!.textContent).toContain(t.driftMarker);
    expect(rows("observed")[0]!.textContent).toContain(t.driftMarker);
    // older principles are not claimed to be in the bundle, and not marked
    expect(rows("declared")[0]!.textContent).not.toContain(t.driftMarker);
    expect(document.body.textContent).not.toMatch(/כלול בגרסה המאושרת|נכלל בגרסה/);
  });

  it("no approved version: an explanation, no drift line, the approve form still there", () => {
    renderStrategy("sparse");
    expect(within(region("approved")).getByText(t.noApprovedTitle)).toBeTruthy();
    expect(region("approved").textContent).not.toContain(t.driftMiddle);
    expect(screen.getByRole("button", { name: t.approveButton })).toBeTruthy();
    expect(region("declared").textContent).toContain(t.declaredEmpty);
    expect(region("observed").textContent).toContain(t.observedEmpty);
  });

  it("no historical bundle contents are shown: the card names only the latest version", () => {
    renderStrategy();
    const card = region("approved");
    expect(card.textContent).not.toMatch(/גרסה 1\b|v1\b/);
    expect(card.querySelectorAll("li")).toHaveLength(0);
  });
});

describe("approve", () => {
  it("explains history semantics, needs a summary, and sends it unchanged", async () => {
    const { a } = renderStrategy();
    expect(screen.getByText(t.approveHint)).toBeTruthy();
    const button = screen.getByRole("button", { name: t.approveButton }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const input = screen.getByLabelText(new RegExp(t.summaryLabel)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  " } });
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "my summary" } });
    // Enter never approves
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.submit(input);
    expect(a.approve.run).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(a.approve.run).toHaveBeenCalledWith("my summary");
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("pending, success and failure", () => {
    const { unmount } = renderStrategy("main", actions({ approve: { pending: true } }));
    expect((screen.getByRole("button", { name: t.approvingButton }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    const { unmount: u2 } = renderStrategy("main", actions({ approve: { approvedVersionNumber: 3 } }));
    expect(screen.getByText((_, el) => el?.getAttribute("role") === "status" && el.textContent === `${t.approvedAsPrefix} 3.`)).toBeTruthy();
    u2();
    renderStrategy("main", actions({ approve: { error: "Another approval just went through — please try again." } }));
    expect(screen.getByRole("alert").textContent).toContain("Another approval just went through");
  });
});

describe("declared proposal flow", () => {
  it("explains that nothing is adopted without confirmation, and runs the existing proposal", () => {
    const { a } = renderStrategy();
    expect(screen.getByText(t.proposeHint)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.proposeButton }));
    expect(a.propose.run).toHaveBeenCalledTimes(1);
  });

  it("no candidates is a calm result", () => {
    renderStrategy("main", actions({ propose: { candidates: [] } }));
    expect(screen.getByText(t.proposeNone)).toBeTruthy();
  });

  it("each candidate starts with the AI wording in an editable field; the edited wording is what gets confirmed", async () => {
    const { a } = renderStrategy("flow");
    const list = screen.getByRole("list", { name: t.candidatesTitle });
    const [first] = within(list).getAllByRole("listitem");
    const box = within(first!).getByLabelText(t.candidateLabel) as HTMLTextAreaElement;
    expect(box.value).toBe(STRATEGY_PREVIEW_CANDIDATES[0]!.statementText);
    fireEvent.change(box, { target: { value: "  my own wording  " } });
    fireEvent.click(within(first!).getByRole("button", { name: t.confirmButton }));
    expect(a.confirm.run).toHaveBeenCalledWith(0, { ...STRATEGY_PREVIEW_CANDIDATES[0]!, statementText: "my own wording" });
    await waitFor(() => expect(within(first!).getByText(t.confirmed)).toBeTruthy());
    expect(within(first!).queryByRole("button", { name: t.confirmButton })).toBeNull();
    expect(box.disabled).toBe(true);
  });

  it("a candidate identical to an existing declared principle is not offered for confirmation", () => {
    renderStrategy("flow");
    const [, second] = within(screen.getByRole("list", { name: t.candidatesTitle })).getAllByRole("listitem");
    expect(second!.textContent).toContain(t.duplicateNote);
    expect(within(second!).queryByRole("button", { name: t.confirmButton })).toBeNull();
    // editing it away from the existing wording makes it confirmable again
    fireEvent.change(within(second!).getByLabelText(t.candidateLabel), { target: { value: "different wording" } });
    expect(within(second!).getByRole("button", { name: t.confirmButton })).toBeTruthy();
  });

  it("while one candidate confirms, the others wait; a failure shows on its own row", () => {
    const a = actions({ confirm: { pendingIndex: 0 }, propose: { candidates: [STRATEGY_PREVIEW_CANDIDATES[0]!, { ...STRATEGY_PREVIEW_CANDIDATES[0]!, statementText: "another" }] } });
    const { unmount } = renderStrategy("main", a);
    const [first, second] = within(screen.getByRole("list", { name: t.candidatesTitle })).getAllByRole("listitem");
    expect((within(first!).getByRole("button", { name: t.confirmingButton }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(second!).getByRole("button", { name: t.confirmButton }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    renderStrategy("flow", actions({ confirm: { error: { index: 0, message: "None of the cited answers belong to this investor." } } }));
    const [f] = within(screen.getByRole("list", { name: t.candidatesTitle })).getAllByRole("listitem");
    expect(within(f!).getByRole("alert").textContent).toContain("None of the cited answers");
  });
});

describe("observed generation", () => {
  it("explains that an observation is not an adopted rule, and shows only the returned counts", () => {
    const { a, unmount } = renderStrategy();
    expect(screen.getByText(t.generateHint)).toBeTruthy();
    fireEvent.click(within(region("generate")).getByRole("button", { name: t.generateButton }));
    expect(a.generate.run).toHaveBeenCalledTimes(1);
    unmount();
    renderStrategy("main", actions({ generate: { result: { createdCount: 0, versionedCount: 0, unchangedCount: 2, droppedCount: 1 } } }));
    const status = within(region("generate")).getByRole("status");
    expect(status.textContent).toContain(t.resultNothingNew);
    expect(status.textContent).toContain(`2 ${t.resultUnchanged}`);
    expect(status.textContent).toContain(`1 ${t.resultDropped}`);
  });
});

describe("page-wide", () => {
  it("renders no raw enum and no score, progress or ranking language", () => {
    const { container } = renderStrategy("flow");
    for (const r of rows("observed")) openEvidence(r);
    const text = container.textContent!;
    for (const raw of [...principleCreatedByEnum.enumValues, ...principleTypeEnum.enumValues, ...evidenceStrengthEnum.enumValues]) {
      expect(text, raw).not.toMatch(new RegExp(`\\b${raw}\\b`));
    }
    expect(container.querySelector("progress, meter, [role=progressbar]")).toBeNull();
    expect(text).not.toMatch(/%|דירוג|ציון/);
  });

  it("loading and a failed list", () => {
    const d = strategyPreviewData("main");
    const { unmount } = render(<StrategyView strategy={{ data: undefined, isLoading: true, isError: false }} reach={d.reach} actions={actions()} renderEvidence={() => null} />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    unmount();
    render(<StrategyView strategy={{ data: undefined, isLoading: false, isError: true, error: { message: "network" } }} reach={d.reach} actions={actions()} renderEvidence={() => null} />);
    expect(screen.getByRole("alert").textContent).toContain("network");
  });
});
