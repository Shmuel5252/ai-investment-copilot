import { describe, expect, it } from "vitest";
import { detectCollisionGroups, type ExistingCollisionRow, type NewCollisionRow } from "@/lib/import/collision-resolution";

function newRow(clientRowKey: string, ticker: string, date: string): NewCollisionRow {
  return { clientRowKey, ticker, transactionDate: new Date(date) };
}

function existingRow(
  id: string,
  ticker: string,
  date: string,
  order: number | null = null,
  reason: ExistingCollisionRow["orderUnknownReason"] = null
): ExistingCollisionRow {
  return { id, ticker, transactionDate: new Date(date), intraDayOrder: order, orderUnknownReason: reason };
}

describe("detectCollisionGroups", () => {
  it("reports nothing for a batch with no same-day collisions", () => {
    const groups = detectCollisionGroups(
      [newRow("r1", "AAPL", "2026-01-01"), newRow("r2", "AAPL", "2026-01-02")],
      []
    );
    expect(groups).toEqual([]);
  });

  it("detects a collision purely within the incoming batch", () => {
    const groups = detectCollisionGroups(
      [newRow("r1", "AAPL", "2026-01-01"), newRow("r2", "AAPL", "2026-01-01")],
      []
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ticker).toBe("AAPL");
    expect(groups[0]!.incoming).toHaveLength(2);
    expect(groups[0]!.existing).toHaveLength(0);
  });

  it("detects a collision between an incoming row and an already-persisted row", () => {
    const groups = detectCollisionGroups(
      [newRow("r1", "MP", "2026-06-12")],
      [existingRow("existing-1", "MP", "2026-06-12")]
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.incoming).toHaveLength(1);
    expect(groups[0]!.existing).toHaveLength(1);
    expect(groups[0]!.existing[0]!.id).toBe("existing-1");
  });

  it("keeps different tickers on the same date fully independent", () => {
    const groups = detectCollisionGroups(
      [newRow("r1", "AAPL", "2026-01-01"), newRow("r2", "MSFT", "2026-01-01")],
      []
    );
    expect(groups).toEqual([]);
  });

  it("ignores rows with no ticker (deposit/withdrawal/fee)", () => {
    const groups = detectCollisionGroups(
      [
        { clientRowKey: "r1", ticker: null, transactionDate: new Date("2026-01-01") },
        { clientRowKey: "r2", ticker: null, transactionDate: new Date("2026-01-01") },
      ],
      []
    );
    expect(groups).toEqual([]);
  });

  it("a three-way collision (two incoming + one existing) is reported as one group with all three members", () => {
    const groups = detectCollisionGroups(
      [newRow("r1", "MP", "2026-06-12"), newRow("r2", "MP", "2026-06-12")],
      [existingRow("existing-1", "MP", "2026-06-12")]
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.incoming).toHaveLength(2);
    expect(groups[0]!.existing).toHaveLength(1);
  });
});
