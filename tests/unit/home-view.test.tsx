// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { List, ListRow } from "@/components/ui/list";
import { HomeView, type HomeData } from "@/components/home/home-view";
import { loaded, type Loadable } from "@/components/home/types";
import { homePage, shell, nextActions } from "@/lib/i18n/strings";
import { HOME_PREVIEW } from "@/app/styleguide/home-preview-data";

// Frontend V1 unit 2 — the List primitive and Home's states, rendered with the
// production components. HOME_PREVIEW is the same synthetic data the
// /styleguide preview renders.

const loading = <T,>(): Loadable<T> => ({ data: undefined, isLoading: true, isError: false });
const failed = <T,>(): Loadable<T> => ({ data: undefined, isLoading: false, isError: true, error: { message: "network" } });

describe("List / ListRow", () => {
  it("renders rows as list items with an optional actions slot after the content", () => {
    render(
      <List label="rows">
        <ListRow actions={<button type="button">act</button>}>first</ListRow>
        <ListRow>second</ListRow>
      </List>
    );
    const list = screen.getByRole("list", { name: "rows" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole("button", { name: "act" })).toBeTruthy();
    expect(within(items[1]!).queryByRole("button")).toBeNull();
    // content precedes the actions in reading order
    expect(items[0]!.textContent).toBe("firstact");
  });
});

describe("HomeView", () => {
  it("renders every region with the synthetic data, and joined actions only inside their attention row", () => {
    render(<HomeView data={HOME_PREVIEW} />);
    for (const title of [homePage.attentionTitle, homePage.stepsTitle, homePage.monitoringTitle, homePage.conditionsTitle, homePage.researchTitle, homePage.memoryTitle]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    const attention = screen.getByRole("list", { name: homePage.attentionTitle });
    const steps = screen.getByRole("list", { name: homePage.stepsTitle });
    // the preview joins "set a review date" into the first attention decision
    expect(within(attention).getAllByText(nextActions.destination.SET_REVIEW_HORIZON!).length).toBe(1);
    expect(within(steps).queryByText(nextActions.destination.SET_REVIEW_HORIZON!)).toBeNull();
  });

  it("shows skeletons while loading and a retryable error when a region fails, independently", () => {
    const data: HomeData = { ...HOME_PREVIEW, attention: loading(), reach: failed() };
    render(<HomeView data={data} />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(shell.loadFailedTitle)).toBeTruthy();
    // conditions still render: one failed region does not take the page down
    expect(screen.getAllByText(homePage.conditionsTitle).length).toBeGreaterThan(0);
  });

  it("shows teaching empty states, not blank regions", () => {
    const empty: HomeData = {
      ...HOME_PREVIEW,
      attention: loaded({ ...HOME_PREVIEW.attention.data!, attention: [], items: [] }),
      nextActions: loaded([]),
      conditions: loaded([]),
      cases: loaded([]),
      ideas: loaded([]),
    };
    render(<HomeView data={empty} />);
    for (const text of [homePage.attentionEmpty, homePage.stepsEmpty, homePage.monitoringEmpty, homePage.conditionsEmpty, homePage.researchEmpty]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });
});
