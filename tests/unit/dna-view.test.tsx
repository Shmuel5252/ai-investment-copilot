// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { DnaView, groupByReach, type DnaActions } from "@/components/dna/dna-view";
import { EvidenceList, sourceKindOf } from "@/components/claims/evidence-disclosure";
import { Disclosure } from "@/components/ui/disclosure";
import { loaded } from "@/components/home/types";
import {
  decisionStatementKindLabel,
  dnaCreatedByLabel,
  dnaPage as t,
  evidenceSourceLabel,
  evidenceStrengthLabel,
} from "@/lib/i18n/strings";
import { dnaPreviewData, DNA_PREVIEW_DECISIONS, DNA_PREVIEW_EVIDENCE } from "@/app/styleguide/dna-preview-data";
import { evidenceStrengthEnum, dnaCreatedByEnum, decisionStatementKindEnum } from "@/db/schema/enums";

// Frontend V1 unit 6A — the DNA page, rendered with the production components
// on the same synthetic data the /styleguide preview uses. Actions are spies;
// no procedure and no AI is called.

function actions(over: { generate?: Partial<DnaActions["generate"]>; reject?: Partial<DnaActions["reject"]> } = {}) {
  return {
    generate: { run: vi.fn(), pending: false, error: null, result: null, ...over.generate },
    reject: { run: vi.fn(async () => true), pendingId: null, error: null, ...over.reject },
  } as DnaActions & { generate: { run: ReturnType<typeof vi.fn> }; reject: { run: ReturnType<typeof vi.fn> } };
}
function renderDna(state: "insufficient" | "mixed" | "empty" = "insufficient", a = actions()) {
  const d = dnaPreviewData(state);
  const view = render(
    <DnaView
      statements={d.statements}
      reach={d.reach}
      actions={a}
      renderEvidence={(id) => <EvidenceList evidence={loaded(DNA_PREVIEW_EVIDENCE[id] ?? [])} decisions={DNA_PREVIEW_DECISIONS} />}
    />
  );
  return { a, ...view };
}
const region = (id: string) => document.getElementById(id) as HTMLElement;
const rows = (id: string) => within(region(id)).queryAllByRole("listitem").filter((li) => li.parentElement?.getAttribute("aria-label") !== t.citationsTitle);
const openEvidence = (row: HTMLElement) => {
  const details = row.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
};

describe("grouping and order", () => {
  it("splits by the authoritative visibleToAi fact and keeps the returned order in each group", () => {
    const reach = new Map([
      ["b", { visibleToAi: true }],
      ["c", { visibleToAi: false }],
      ["d", { visibleToAi: true }],
    ]);
    const { used, below } = groupByReach([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], reach);
    expect(used.map((s) => s.id)).toEqual(["b", "d"]);
    // a statement with no reach record is never counted as used
    expect(below.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("does not re-sort by tier or counts: the mixed page shows the returned order", () => {
    renderDna("mixed");
    expect(rows("used").map((r) => r.querySelector("p")!.textContent)).toEqual([
      "טענת דוגמה: מגדיר גודל פוזיציה לפני הכניסה.",
      "טענת דוגמה: חוזר לרעיונות שנפסלו כשמשהו מהותי משתנה.",
    ]);
    expect(rows("below")).toHaveLength(2);
    expect(region("below").textContent).toContain(t.orderHint);
    expect(document.body.textContent).not.toMatch(/החדש ראשון|newest/);
  });
});

describe("statement rows", () => {
  it("render the stored statement verbatim with the tier badge and the three counts", () => {
    renderDna("insufficient");
    const first = rows("below")[0]!;
    expect(first.querySelector("p")!.textContent).toBe("טענת דוגמה: נוטה לבדוק מחדש את התזה לפני הוספה לפוזיציה קיימת.");
    expect(within(first).getByText(evidenceStrengthLabel.insufficient_evidence!)).toBeTruthy();
    expect(first.textContent).toContain(`2 ${t.supportingCasesSuffix}`);
    expect(first.textContent).toContain(`0 ${t.contradictingSuffix}`);
    expect(first.textContent).toContain(`3 ${t.citedSuffix}`);
    expect(first.textContent).toContain(t.notUsedByAi);
  });

  it("all below the threshold is a calm, normal state", () => {
    renderDna("insufficient");
    expect(within(region("used")).getByText(t.usedEmpty)).toBeTruthy();
    expect(rows("below")).toHaveLength(3);
  });

  it("show no score, percentage, progress bar or tier ladder", () => {
    const { container } = renderDna("mixed");
    expect(container.querySelector("progress, meter, [role=progressbar]")).toBeNull();
    // the only mention of a score is the page saying the tier is not one
    expect(container.textContent).not.toMatch(/%|\/\s*100|נקודות/);
    // distance to the next tier is not on the row, only inside the evidence
    const first = rows("used")[0]!;
    const outside = [...first.childNodes].map((n) => (n as HTMLElement).querySelector?.("details") ? "" : n.textContent).join("");
    expect(outside).not.toContain(t.distanceMiddle);
  });

  it("render no raw enum value", () => {
    const { container } = renderDna("mixed");
    for (const s of rows("used").concat(rows("below"))) openEvidence(s);
    const text = container.textContent!;
    for (const raw of [...evidenceStrengthEnum.enumValues, ...dnaCreatedByEnum.enumValues, ...decisionStatementKindEnum.enumValues, "supporting", "contradicting", "interview_answer"]) {
      expect(text, raw).not.toMatch(new RegExp(`\\b${raw}\\b`));
    }
  });
});

describe("evidence disclosure", () => {
  it("mounts citations only after it is opened, then shows version facts and citations", () => {
    renderDna("insufficient");
    const first = rows("below")[0]!;
    expect(first.textContent).not.toContain(t.aiSummaryLabel);
    openEvidence(first);
    expect(first.textContent).toContain(`${t.versionPrefix} 3`);
    expect(first.textContent).toContain(dnaCreatedByLabel.system_grounding_revalidation);
    expect(first.textContent).toContain("Sample stored change reason, kept in its original language.");
    expect(first.textContent).toContain(t.casesNote);
    expect(first.textContent).toContain(t.distanceMiddle);
  });

  it("shows supporting and contradicting citations in their returned order, each with a labeled AI summary", () => {
    renderDna("insufficient");
    const first = rows("below")[0]!;
    openEvidence(first);
    const cites = within(within(first).getByRole("list", { name: t.citationsTitle })).getAllByRole("listitem");
    expect(cites).toHaveLength(3);
    expect(cites[0]!.textContent).toContain("תומך");
    expect(cites[2]!.textContent).toContain("סותר");
    for (const c of cites) expect(c.textContent).toContain(t.aiSummaryLabel);
  });

  it("an interview citation says its text is not available; a decision citation links to the decision", () => {
    renderDna("insufficient");
    const first = rows("below")[0]!;
    openEvidence(first);
    const cites = within(within(first).getByRole("list", { name: t.citationsTitle })).getAllByRole("listitem");
    expect(cites[0]!.textContent).toContain(t.answerTextUnavailable);
    expect(cites[0]!.textContent).toContain(evidenceSourceLabel.interview_answer);
    expect(cites[1]!.textContent).toContain(`${evidenceSourceLabel.decision_statement} · ${decisionStatementKindLabel.reasoning}`);
    expect(within(cites[1]!).getByRole("link", { name: t.openDecision }).getAttribute("href")).toBe("/decisions/d1");
    expect(cites[1]!.textContent).not.toContain(t.answerTextUnavailable);
  });

  it("missing provenance and independence records are said as missing", () => {
    renderDna("insufficient");
    const third = rows("below")[2]!;
    openEvidence(third);
    expect(third.textContent).toContain(t.provenanceMissing);
    expect(third.textContent).toContain(t.basisMissing);
    const first = rows("below")[0]!;
    openEvidence(first);
    expect(first.textContent).not.toContain(t.provenanceMissing);
  });

  it("a failed evidence read stays inside its disclosure", () => {
    render(<EvidenceList evidence={{ data: undefined, isLoading: false, isError: true, error: { message: "boom" } }} decisions={[]} />);
    expect(screen.getByRole("alert").textContent).toContain(t.evidenceFailed);
  });

  it("maps each source key to one kind", () => {
    const base = { id: "x", stance: "supporting", interviewAnswerId: null, decisionId: null, decisionStatementKind: null, decisionReviewId: null, transactionId: null, sourceLearningInsightId: null, manualNoteText: null, description: "", createdAt: "" };
    expect(sourceKindOf({ ...base, interviewAnswerId: "a" })).toBe("interview_answer");
    expect(sourceKindOf({ ...base, decisionId: "d" })).toBe("decision_statement");
    expect(sourceKindOf({ ...base, manualNoteText: "n" })).toBe("manual_note");
    expect(sourceKindOf(base)).toBe("none");
  });
});

describe("generate", () => {
  it("explains what it does before running, and calls the existing action", () => {
    const { a } = renderDna();
    expect(screen.getByText(t.generateHint)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.generateButton }));
    expect(a.generate.run).toHaveBeenCalledTimes(1);
  });

  it("shows the four result counts, and says calmly when nothing new was found", () => {
    const { unmount } = renderDna("insufficient", actions({ generate: { result: { createdCount: 1, versionedCount: 2, unchangedCount: 3, droppedCount: 4 } } }));
    const status = screen.getAllByRole("status").find((s) => s.textContent!.includes(t.resultCreated))!;
    expect(status.textContent).toContain(`1 ${t.resultCreated}`);
    expect(status.textContent).toContain(`2 ${t.resultVersioned}`);
    expect(status.textContent).toContain(`3 ${t.resultUnchanged}`);
    expect(status.textContent).toContain(`4 ${t.resultDropped}`);
    expect(status.textContent).not.toContain(t.resultNothingNew);
    unmount();
    renderDna("insufficient", actions({ generate: { result: { createdCount: 0, versionedCount: 0, unchangedCount: 5, droppedCount: 1 } } }));
    expect(screen.getByText(t.resultNothingNew)).toBeTruthy();
  });
});

describe("reject", () => {
  it("needs a second confirmation that says there is no restore, then calls the existing action", async () => {
    const { a } = renderDna();
    const first = rows("below")[0]!;
    fireEvent.click(within(first).getByRole("button", { name: t.rejectButton }));
    expect(a.reject.run).not.toHaveBeenCalled();
    expect(first.textContent).toContain(t.rejectConfirmText);
    fireEvent.click(within(first).getByRole("button", { name: t.rejectConfirm }));
    await waitFor(() => expect(a.reject.run).toHaveBeenCalledWith("h-1"));
    // the row stays until the list itself refetches without it
    expect(rows("below")).toHaveLength(3);
  });

  it("cancel returns to the plain action; a failure shows on that row only", () => {
    renderDna("insufficient", actions({ reject: { error: { id: "h-2", message: "Server said no" } } }));
    const [first, second] = rows("below");
    fireEvent.click(within(first!).getByRole("button", { name: t.rejectButton }));
    fireEvent.click(within(first!).getByRole("button", { name: t.rejectCancel }));
    expect(within(first!).getByRole("button", { name: t.rejectButton })).toBeTruthy();
    fireEvent.click(within(second!).getByRole("button", { name: t.rejectButton }));
    expect(within(second!).getByRole("alert").textContent).toContain("Server said no");
    expect(within(first!).queryByRole("alert")).toBeNull();
  });

  it("offers no restore action anywhere", () => {
    const { container } = renderDna("mixed");
    expect(container.textContent).not.toMatch(/שחזר|החזר את הטענה|restore/i);
  });
});

describe("states", () => {
  it("empty: an explanation with a link to the interview", () => {
    renderDna("empty");
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: t.openInterview }).getAttribute("href")).toBe("/interview");
  });

  it("loading and a failed list", () => {
    const d = dnaPreviewData("insufficient");
    const { unmount } = render(<DnaView statements={{ data: undefined, isLoading: true, isError: false }} reach={d.reach} actions={actions()} renderEvidence={() => null} />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    unmount();
    render(<DnaView statements={{ data: undefined, isLoading: false, isError: true, error: { message: "network" } }} reach={d.reach} actions={actions()} renderEvidence={() => null} />);
    expect(screen.getByRole("alert").textContent).toContain("network");
  });
});

describe("shared Disclosure", () => {
  it("keeps the Decision classes and behavior, and reports toggles only when asked", () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(<Disclosure summary="s">body</Disclosure>);
    const details = container.querySelector("details")!;
    expect(details.className).toBe("group");
    expect(details.open).toBe(false);
    expect(container.querySelector("summary")!.className).toBe(
      "flex cursor-pointer list-none items-center gap-2 py-1 text-sm font-semibold text-ink-2 [&::-webkit-details-marker]:hidden"
    );
    expect(container.querySelector("summary + div")!.className).toBe("mt-2 flex flex-col gap-3");
    rerender(
      <Disclosure summary="s" onToggle={onToggle}>
        body
      </Disclosure>
    );
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
