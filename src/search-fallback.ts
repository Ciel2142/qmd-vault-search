export interface SearchOutcome { errored: boolean; resultCount: number }
export interface FallbackOpts { fallbackOnFailure: boolean; fallbackOnZero: boolean }
export type FallbackReason = "failure" | "zero";
export interface FallbackDecision { fallback: boolean; reason: FallbackReason | null }

/** Hybrid path only. Decides whether to re-run the query as keyword-only, and why. */
export function decideFallback(o: SearchOutcome, opts: FallbackOpts): FallbackDecision {
  if (o.errored) {
    return opts.fallbackOnFailure ? { fallback: true, reason: "failure" } : { fallback: false, reason: null };
  }
  if (o.resultCount === 0 && opts.fallbackOnZero) return { fallback: true, reason: "zero" };
  return { fallback: false, reason: null };
}
