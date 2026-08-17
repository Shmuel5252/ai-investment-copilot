import { useCallback, useRef } from "react";

// Closes a real, recurring bug class (found 3 times independently:
// CSV import, ensureDefaultRiskPrinciples, "Approve as new strategy
// version" — see git history) rather than patching each mutation-
// triggering button as it's hit. `disabled={mutation.isPending}` is NOT
// enough on its own: `isPending` only flips true after React re-renders
// following the first click, so a fast double-click (or a slow network
// making the first click's disabled state feel unresponsive, inviting a
// second click) can fire the handler twice before the button visually
// disables. This hook closes that gap with a plain ref flipped
// synchronously inside the same click handler, independent of any
// render — the actual fix; disabling the button on `isPending` is still
// worth keeping for visual feedback, but isn't load-bearing anymore.
//
// Deliberately NOT a debounce/throttle (which would swallow legitimate
// separate actions) and NOT a global idempotency-key/backend layer —
// this is a personal single-user app with no concurrent-multi-device
// story; a same-tab synchronous guard is the proportionate fix for the
// actual failure mode observed. The DB-level UNIQUE(parent, version_number)
// constraints added alongside this are the backstop for genuine
// concurrent requests (two tabs, a retried network request), which this
// hook does not and cannot cover on its own.
//
// Keyed, not a single flag: one component often uses the same guard
// instance for both a lone page-level button (default key) and a
// per-row action inside a list (e.g. "Disagree" on one hypothesis among
// several) — those rows are unrelated actions and must not block each
// other, only a repeat click on the *same* row/action should.
export function useSubmitGuard() {
  const submitting = useRef<Set<string>>(new Set());

  return useCallback(async <T,>(action: () => Promise<T>, key: string = "default"): Promise<T | undefined> => {
    if (submitting.current.has(key)) return undefined;
    submitting.current.add(key);
    try {
      return await action();
    } finally {
      submitting.current.delete(key);
    }
  }, []);
}
