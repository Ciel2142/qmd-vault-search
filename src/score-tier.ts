import type { SearchMode } from "./search-plan";

export type ScoreTier = "high" | "med" | "low";

/** Control order, highest floor first. */
export const TIERS: ScoreTier[] = ["high", "med", "low"];

/** qmd CLI parity: green > 0.7 (HIGH), yellow > 0.4 (MED), dim otherwise (LOW). Uses >= at the boundary. */
export function scoreTier(score: number): ScoreTier {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "med";
  return "low";
}

/** Minimum-score floor for a tier, passed to qmd's `minScore`. "low" = 0 = no filtering. */
export function tierFloor(tier: ScoreTier): number {
  if (tier === "high") return 0.7;
  if (tier === "med") return 0.4;
  return 0;
}

/** Uppercase label for the badge / control button. */
export function tierLabel(tier: ScoreTier): string {
  return tier.toUpperCase();
}

/** Empty-state message when a min-tier filter hides everything. Only "high"/"med" filter to empty. */
export function tierEmptyText(tier: ScoreTier): string {
  const suggest = tier === "high" ? "MED or LOW" : "LOW";
  return `No ${tierLabel(tier)}-relevance results — try ${suggest}.`;
}

/** Tiers are meaningful only for reranked hybrid scores (normalized 0-1). */
export function tiersActive(mode: SearchMode, rerank: boolean): boolean {
  return mode === "hybrid" && rerank;
}
