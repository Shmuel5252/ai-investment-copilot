// @vitest-environment jsdom
//
// Direct regression test for the hook that's now the primary fix for a
// bug class hit 3 times independently (CSV import, ensureDefaultRiskPrinciples,
// "Approve as new strategy version" — see git history): a synchronous,
// keyed guard against double-submit that `disabled={mutation.isPending}`
// alone doesn't close (see src/lib/use-submit-guard.ts's own comment for
// why). jsdom needed here specifically for renderHook — see
// vitest.config.ts's comment on why the project defaults to node.
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useSubmitGuard", () => {
  it("blocks a second call with the same key while the first is still in flight", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    const action = vi.fn();
    const first = deferred<string>();
    action.mockReturnValueOnce(first.promise);

    let firstCallPromise!: Promise<string | undefined>;
    let secondCallPromise!: Promise<string | undefined>;
    act(() => {
      firstCallPromise = result.current(action, "same-key");
      secondCallPromise = result.current(action, "same-key");
    });

    // The synchronous guard already fired both calls to `result.current`
    // before either promise resolved — this is the actual race being
    // tested (double-click within the same tick).
    expect(action).toHaveBeenCalledTimes(1);

    act(() => first.resolve("done"));
    await expect(firstCallPromise).resolves.toBe("done");
    await expect(secondCallPromise).resolves.toBeUndefined();
  });

  it("does not block a call with a different key (unrelated list-row actions)", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    const action = vi.fn().mockResolvedValue("ok");

    let a!: Promise<string | undefined>;
    let b!: Promise<string | undefined>;
    act(() => {
      a = result.current(action, "row-1");
      b = result.current(action, "row-2");
    });

    expect(action).toHaveBeenCalledTimes(2);
    await expect(a).resolves.toBe("ok");
    await expect(b).resolves.toBe("ok");
  });

  it("allows a repeat call with the same key once the first has settled", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    const action = vi.fn().mockResolvedValue("first");

    await act(async () => {
      await expect(result.current(action, "k")).resolves.toBe("first");
    });

    action.mockResolvedValue("second");
    await act(async () => {
      await expect(result.current(action, "k")).resolves.toBe("second");
    });

    expect(action).toHaveBeenCalledTimes(2);
  });

  it("releases the guard even when the action rejects", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    const failing = vi.fn().mockRejectedValue(new Error("boom"));

    await act(async () => {
      await expect(result.current(failing, "k")).rejects.toThrow("boom");
    });

    const succeeding = vi.fn().mockResolvedValue("ok");
    await act(async () => {
      await expect(result.current(succeeding, "k")).resolves.toBe("ok");
    });
  });

  it("defaults to a shared key when none is given", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    const action = vi.fn();
    const first = deferred<string>();
    action.mockReturnValueOnce(first.promise);

    let firstCallPromise!: Promise<string | undefined>;
    let secondCallPromise!: Promise<string | undefined>;
    act(() => {
      firstCallPromise = result.current(action);
      secondCallPromise = result.current(action);
    });

    expect(action).toHaveBeenCalledTimes(1);
    act(() => first.resolve("done"));
    await firstCallPromise;
    await expect(secondCallPromise).resolves.toBeUndefined();
  });
});
