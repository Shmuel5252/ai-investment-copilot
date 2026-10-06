// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { loaded, type Loadable } from "@/components/home/types";
import { LearningEvidence, LearningView, currentInsights, currentVersionEvidence, type LearningActions, type LearningAgreeResult, type LearningInsightRow } from "@/components/learning/learning-view";
import { PREVIEW_EVIDENCE, PREVIEW_GENERATE_RESULT, PREVIEW_INSIGHTS } from "@/app/styleguide/learning-preview-data";
import { evidenceStanceLabel, evidenceStrengthLabel, learningPage as t, reviewQualityLabel, thesisAccuracyLabel } from "@/lib/i18n/strings";

// Frontend V1 unit 8 — Learning, rendered with the production component on
// the synthetic data the /styleguide preview uses. Only the injected actions
// are stubbed; no procedure, AI or database is involved.

const trpcError = (message: string, code: string) => Object.assign(new Error(message), { data: { code } });
const generate = (over: Partial<LearningActions["generate"]> = {}): LearningActions["generate"] => ({ run: vi.fn(), pending: false, error: null, result: null, ...over });

function actions(over: Partial<LearningActions> = {}) {
  return {
    generate: generate(),
    agree: vi.fn(async () => ({ replayed: false, carried: { cases: 2, groundedCitations: 3 } })),
    disagree: vi.fn(async () => undefined),
    ...over,
  };
}
function renderLearning(insights: Loadable<LearningInsightRow[]> = loaded(PREVIEW_INSIGHTS), a = actions()) {
  render(
    <LearningView
      insights={insights}
      actions={a as LearningActions}
      renderEvidence={(id, version) => <LearningEvidence version={version} evidence={loaded(PREVIEW_EVIDENCE[id] ?? [])} />}
    />
  );
  return a;
}
const rows = () => Array.from(screen.getByRole("list", { name: t.listLabel }).children) as HTMLElement[];
const rowOf = (sector: string) => rows().find((r) => r.textContent?.includes(sector)) as HTMLElement;
function openEvidence(row: HTMLElement) {
  const details = Array.from(row.querySelectorAll("details")).find((d) => d.querySelector("summary")?.textContent?.includes(t.evidenceSummary)) as HTMLDetailsElement;
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  return details;
}
function openRespond(row: HTMLElement, note?: string) {
  fireEvent.click(within(row).getByRole("button", { name: t.respondButton }));
  const box = within(row).getByLabelText(new RegExp(t.noteLabel)) as HTMLTextAreaElement;
  if (note !== undefined) fireEvent.change(box, { target: { value: note } });
  return box;
}

describe("the insight list", () => {
  it("is Hebrew chrome titled תובנות למידה, framed as candidate patterns, not advice", () => {
    renderLearning();
    expect(screen.getByRole("heading", { level: 1, name: t.title })).toBeTruthy();
    expect(t.title).toBe("תובנות למידה");
    expect(document.body.textContent).toContain(t.description);
    for (const [key, value] of Object.entries(t)) expect(value, key).toMatch(/[א-ת]/);
  });

  it("shows one current insight per family, the newest, in server order", () => {
    renderLearning();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.textContent).toContain("Sample Sector A");
    expect(rows()[1]!.textContent).toContain("Sample Sector B");
    expect(document.body.textContent).not.toContain("OLDER identity");
    expect(currentInsights(PREVIEW_INSIGHTS).map((i) => i.id)).toEqual(["insight-a2", "insight-b1"]);
  });

  it("renders the AI statement verbatim as English (ltr/en) with a language note", () => {
    renderLearning();
    const statement = within(rowOf("Sample Sector A")).getByText(PREVIEW_INSIGHTS[0]!.versions[0]!.statementText);
    expect(statement.getAttribute("dir")).toBe("ltr");
    expect(statement.getAttribute("lang")).toBe("en");
    expect(rowOf("Sample Sector A").textContent).toContain(t.statementNote);
  });

  it("shows Evidence Strength on a neutral badge, with version, date and AI authorship", () => {
    renderLearning();
    const row = rowOf("Sample Sector A");
    const badge = within(row).getByText(evidenceStrengthLabel.moderate!, { exact: false }).closest("span") as HTMLElement;
    expect(badge.className).toContain("bg-neutral-soft");
    expect(row.innerHTML).not.toMatch(/bg-(positive|negative|caution|info)|text-(positive|negative)|green|red-/);
    expect(row.textContent).toContain(`${t.versionPrefix} 2`);
    expect(row.textContent).toContain(new Date("2026-09-28T09:00:00.000Z").toLocaleDateString("he-IL"));
    expect(row.textContent).toContain(t.aiAuthored);
  });

  it("labels the tallies as sector-wide, apart from evidence, with neutral labels", () => {
    renderLearning();
    const row = rowOf("Sample Sector A");
    const tallies = Array.from(row.querySelectorAll("details")).find((d) => d.querySelector("summary")?.textContent?.includes(t.talliesSummary)) as HTMLDetailsElement;
    expect(tallies.open).toBe(false);
    expect(tallies.textContent).toContain(t.talliesNote);
    expect(tallies.textContent).toContain(`${reviewQualityLabel.strong} 1`);
    expect(tallies.textContent).toContain(`${thesisAccuracyLabel.refuted} 1`);
    expect(tallies.innerHTML).not.toMatch(/positive|negative|green|red-/);
    expect(tallies.textContent).not.toContain(t.evidenceNote);
  });

  it("says nothing about recommendations, rankings, outcomes or P&L", () => {
    renderLearning();
    expect(document.body.textContent).not.toMatch(/מומלץ|כדאי לך|המלצה:|דירוג|ציון|רווח|הפסד|תשואה|P&L|%/);
    // the one mention of advice is the disclaimer that this is not advice
    expect(t.description).toContain("ולא המלצה לפעולה");
    const all = Object.values(t).join(" ");
    expect(all).not.toMatch(/הסכמה מוסיפה ל-DNA|מוסיף ל-DNA/);
  });
});

describe("evidence of the current version", () => {
  it("filters accumulated rows to the current version's cited reviews; a stale row is excluded", () => {
    renderLearning();
    const details = openEvidence(rowOf("Sample Sector A"));
    expect(details.textContent).toContain("Sample: this review found the entry");
    expect(details.textContent).not.toContain("STALE");
    expect(details.querySelectorAll("li")).toHaveLength(3);
    expect(details.textContent).not.toContain(t.evidenceLegacy);
  });

  it("matches on review AND stance", () => {
    const flipped = currentVersionEvidence(
      { provenanceJson: { citedReviews: [{ decisionReviewId: "review-1", stance: "contradicting" }] } },
      PREVIEW_EVIDENCE["insight-a2"]!
    );
    expect(flipped).toEqual({ legacy: false, rows: [] });
  });

  it("a version without provenance shows every stored row, with the limitation note", () => {
    renderLearning();
    const details = openEvidence(rowOf("Sample Sector B"));
    expect(details.textContent).toContain(t.evidenceLegacy);
    expect(details.querySelectorAll("li")).toHaveLength(2);
    expect(currentVersionEvidence({ provenanceJson: null }, PREVIEW_EVIDENCE["insight-b1"]!).legacy).toBe(true);
  });

  it("uses neutral stance labels, English descriptions, no decision link and no raw provenance", () => {
    renderLearning();
    const details = openEvidence(rowOf("Sample Sector A"));
    expect(details.textContent).toContain(evidenceStanceLabel.supporting);
    expect(details.textContent).toContain(evidenceStanceLabel.contradicting);
    expect(details.innerHTML).not.toMatch(/positive|negative|green|red-/);
    const description = within(details).getByText("Sample: this review shows the same pattern of waiting for a pullback.");
    expect(description.getAttribute("dir")).toBe("ltr");
    expect(description.getAttribute("lang")).toBe("en");
    expect(details.querySelector("a")).toBeNull();
    expect(document.body.textContent).not.toMatch(/review-\d|decision-\d|citedReviews|evidenceFingerprint|lef-v1|learning\.generate|\{"/);
  });

  it("is not read until opened", () => {
    const renderEvidence = vi.fn(() => null);
    render(<LearningView insights={loaded(PREVIEW_INSIGHTS)} actions={actions() as LearningActions} renderEvidence={renderEvidence} />);
    expect(renderEvidence).not.toHaveBeenCalled();
  });
});

describe("generate", () => {
  it("explains when a sector can be considered, without encouraging more trading", () => {
    renderLearning();
    expect(document.body.textContent).toContain(t.generateHint);
    expect(t.generateHint).toContain("לפחות שתי החלטות שנבדקו");
    expect(document.body.textContent).not.toMatch(/בצע עוד|עסקאות נוספות|סחור/);
  });

  it("shows all five result counts", () => {
    renderLearning(loaded(PREVIEW_INSIGHTS), actions({ generate: generate({ result: PREVIEW_GENERATE_RESULT }) }));
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(`2 ${t.resultConsidered}`);
    expect(status.textContent).toContain(`0 ${t.resultCreated}`);
    expect(status.textContent).toContain(`1 ${t.resultVersioned}`);
    expect(status.textContent).toContain(`1 ${t.resultUnchanged}`);
    expect(status.textContent).toContain(`0 ${t.resultDropped}`);
  });

  it("shows a generation failure and the pending label", () => {
    renderLearning(loaded(PREVIEW_INSIGHTS), actions({ generate: generate({ error: "boom", pending: true }) }));
    expect(screen.getByText("boom")).toBeTruthy();
    expect(screen.getByRole("button", { name: t.generatingButton }).hasAttribute("disabled")).toBe(true);
  });

  it("runs the injected action on click", () => {
    const a = actions();
    renderLearning(loaded(PREVIEW_INSIGHTS), a);
    fireEvent.click(screen.getByRole("button", { name: t.generateButton }));
    expect(a.generate.run).toHaveBeenCalledTimes(1);
  });
});

describe("agree", () => {
  it("explains before submit that the agreement is not evidence and DNA is created only if grounded", () => {
    renderLearning();
    openRespond(rowOf("Sample Sector A"));
    expect(rowOf("Sample Sector A").textContent).toContain(t.agreeExplain);
    expect(t.agreeExplain).toContain("ההסכמה עצמה אינה ראיה");
    expect(t.agreeExplain).toContain("רק אם");
  });

  it("requires a note: blank or whitespace keeps both actions disabled", () => {
    renderLearning();
    const row = rowOf("Sample Sector A");
    openRespond(row, "   ");
    expect((within(row).getByRole("button", { name: t.agreeButton }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(row).getByRole("button", { name: t.disagreeButton }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends exactly {learningInsightId, note}, once, and shows the carried result", async () => {
    let resolve!: (v: { replayed: boolean; carried: { cases: number; groundedCitations: number } }) => void;
    const a = actions({ agree: vi.fn(() => new Promise<LearningAgreeResult>((r) => (resolve = r))) });
    renderLearning(loaded(PREVIEW_INSIGHTS), a);
    const row = rowOf("Sample Sector A");
    openRespond(row, "  my note ");
    const button = within(row).getByRole("button", { name: t.agreeButton });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => resolve({ replayed: false, carried: { cases: 2, groundedCitations: 3 } }));
    expect(a.agree).toHaveBeenCalledTimes(1);
    expect(a.agree).toHaveBeenCalledWith({ learningInsightId: "insight-a2", note: "  my note " });
    expect(await within(rowOf("Sample Sector A")).findByText(t.carriedTitle)).toBeTruthy();
    expect(rowOf("Sample Sector A").textContent).toContain(`${t.carriedBodyPrefix} 2 ${t.carriedBodyCases} 3`);
    expect(within(rowOf("Sample Sector A")).getByRole("link", { name: t.toDna }).getAttribute("href")).toBe("/dna");
  });

  it("a replayed agreement says it was already handled, never a second hypothesis", async () => {
    renderLearning(loaded(PREVIEW_INSIGHTS), actions({ agree: vi.fn(async () => ({ replayed: true, carried: null })) }));
    openRespond(rowOf("Sample Sector A"), "note");
    fireEvent.click(within(rowOf("Sample Sector A")).getByRole("button", { name: t.agreeButton }));
    expect(await within(rowOf("Sample Sector A")).findByText(t.replayedTitle)).toBeTruthy();
    expect(rowOf("Sample Sector A").textContent).not.toContain(t.carriedTitle);
  });

  it("a BAD_REQUEST refusal explains nothing was carried and keeps the note", async () => {
    renderLearning(loaded(PREVIEW_INSIGHTS), actions({ agree: vi.fn(async () => Promise.reject(trpcError("None of the cited decisions' own statements ground this insight.", "BAD_REQUEST"))) }));
    const box = openRespond(rowOf("Sample Sector A"), "my note");
    fireEvent.click(within(rowOf("Sample Sector A")).getByRole("button", { name: t.agreeButton }));
    expect(await within(rowOf("Sample Sector A")).findByText(t.refusedTitle)).toBeTruthy();
    expect(rowOf("Sample Sector A").textContent).toContain(t.refusedBody);
    expect(box.value).toBe("my note");
    expect(rowOf("Sample Sector A").textContent).not.toContain(t.carriedTitle);
  });

  it("a grounding check that could not run (SERVICE_UNAVAILABLE) says so — not 'not grounded' — and keeps the note", async () => {
    renderLearning(loaded(PREVIEW_INSIGHTS), actions({ agree: vi.fn(async () => Promise.reject(trpcError("The grounding check could not run (3 of 3 statement checks failed technically) — nothing was saved. Try again later.", "SERVICE_UNAVAILABLE"))) }));
    const box = openRespond(rowOf("Sample Sector A"), "my note");
    fireEvent.click(within(rowOf("Sample Sector A")).getByRole("button", { name: t.agreeButton }));
    expect(await within(rowOf("Sample Sector A")).findByText(t.uncheckableTitle)).toBeTruthy();
    expect(rowOf("Sample Sector A").textContent).toContain(t.uncheckableBody);
    expect(rowOf("Sample Sector A").textContent).not.toContain(t.refusedBody);
    expect(rowOf("Sample Sector A").textContent).not.toContain(t.failedTitle);
    expect(box.value).toBe("my note");
  });

  it("any other failure shows a general error and keeps the note", async () => {
    renderLearning(loaded(PREVIEW_INSIGHTS), actions({ agree: vi.fn(async () => Promise.reject(trpcError("network", "INTERNAL_SERVER_ERROR"))) }));
    const box = openRespond(rowOf("Sample Sector A"), "my note");
    fireEvent.click(within(rowOf("Sample Sector A")).getByRole("button", { name: t.agreeButton }));
    expect(await within(rowOf("Sample Sector A")).findByText(t.failedTitle)).toBeTruthy();
    expect(rowOf("Sample Sector A").textContent).toContain(t.failedBody);
    expect(rowOf("Sample Sector A").textContent).not.toContain(t.refusedTitle);
    expect(box.value).toBe("my note");
  });
});

describe("disagree", () => {
  it("explains it changes nothing else, sends the exact input once, and confirms truthfully", async () => {
    const a = actions();
    renderLearning(loaded(PREVIEW_INSIGHTS), a);
    const row = rowOf("Sample Sector B");
    openRespond(row, "I read it differently");
    expect(row.textContent).toContain(t.disagreeExplain);
    const button = within(row).getByRole("button", { name: t.disagreeButton });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await within(rowOf("Sample Sector B")).findByText(t.disagreedTitle)).toBeTruthy();
    expect(a.disagree).toHaveBeenCalledTimes(1);
    expect(a.disagree).toHaveBeenCalledWith({ learningInsightId: "insight-b1", note: "I read it differently" });
    expect(rowOf("Sample Sector B").textContent).toContain(t.disagreedBody);
    expect(a.agree).not.toHaveBeenCalled();
  });

  it("a failure keeps the note", async () => {
    renderLearning(loaded(PREVIEW_INSIGHTS), actions({ disagree: vi.fn(async () => Promise.reject(trpcError("network", "INTERNAL_SERVER_ERROR"))) }));
    const box = openRespond(rowOf("Sample Sector B"), "note");
    fireEvent.click(within(rowOf("Sample Sector B")).getByRole("button", { name: t.disagreeButton }));
    expect(await within(rowOf("Sample Sector B")).findByText(t.failedTitle)).toBeTruthy();
    expect(box.value).toBe("note");
    expect(rowOf("Sample Sector B").textContent).not.toContain(t.disagreedTitle);
  });

  it("shows no earlier response state on load", () => {
    renderLearning();
    for (const s of [t.carriedTitle, t.replayedTitle, t.disagreedTitle, t.refusedTitle]) expect(document.body.textContent).not.toContain(s);
  });
});

describe("states", () => {
  it("loading shows a skeleton, not the empty state", () => {
    renderLearning({ data: undefined, isLoading: true, isError: false });
    expect(document.body.textContent).not.toContain(t.emptyTitle);
    expect(document.querySelector("[aria-busy], .animate-pulse, [role=status]")).toBeTruthy();
  });

  it("a list failure offers a retry", async () => {
    const refetch = vi.fn();
    renderLearning({ data: undefined, isLoading: false, isError: true, error: { message: "x" }, refetch });
    fireEvent.click(screen.getByRole("button", { name: /נסה שוב/ }));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("empty: explains when insights appear, links to /decisions, never encourages more trading", () => {
    renderLearning(loaded([]));
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(document.body.textContent).toContain(t.emptyBody);
    expect(screen.getByRole("link", { name: t.emptyLink }).getAttribute("href")).toBe("/decisions");
    expect(document.body.textContent).not.toMatch(/בצע עוד|עסקאות נוספות|החלף סקטור/);
  });
});
