import { planQuery, type SearchMode } from "./search-plan";
import type { QmdSubQuery } from "./qmd-client";
import type { QmdSettings } from "./settings";

export type ModalSearchPlan =
  | { kind: "clear" }
  | { kind: "run"; searches: QmdSubQuery[]; rerank: boolean; collections: string[] };

/**
 * The modal's single query decision. Forces trigger "enter" so hybrid emits
 * [lex,vec] live (a SuggestModal has no free Enter — Enter chooses a result).
 * rerank mirrors the panel: only hybrid reranks, and only per settings.rerank.
 */
export function planModalSearch(mode: SearchMode, query: string, settings: QmdSettings): ModalSearchPlan {
  const plan = planQuery("enter", mode, query);
  if (plan.kind !== "run") return { kind: "clear" };
  return {
    kind: "run",
    searches: plan.searches,
    rerank: mode === "hybrid" ? settings.rerank : false,
    collections: [settings.vaultCollectionName, ...settings.externalCollections],
  };
}
