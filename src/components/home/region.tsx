import { Skeleton, ErrorState } from "@/components/ui/states";
import type { Loadable } from "./types";

// One loading / error / content switch for every Home region, so each region
// loads independently and fails on its own without taking the page down.
export function RegionBody<T>({ q, lines = 3, children }: { q: Loadable<T>; lines?: number; children: (data: T) => React.ReactNode }) {
  if (q.isError) return <ErrorState message={q.error?.message ?? null} onRetry={q.refetch ? () => void q.refetch!() : undefined} />;
  if (q.isLoading || q.data === undefined) return <Skeleton lines={lines} />;
  return <>{children(q.data)}</>;
}
