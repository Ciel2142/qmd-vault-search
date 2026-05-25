import type { QmdSubQuery } from "./qmd-client";

export type SearchMode = "keyword" | "hybrid";
export type SearchTrigger = "input" | "enter";

export type QueryPlan =
  | { kind: "clear" }                          // empty query → empty the list
  | { kind: "none" }                           // nothing to do (hybrid waiting for Enter)
  | { kind: "run"; searches: QmdSubQuery[] };  // fire this query

/** The only mode/trigger branching for the search panel. Pure; no obsidian, no client. */
export function planQuery(trigger: SearchTrigger, mode: SearchMode, query: string): QueryPlan {
  if (query.trim() === "") return { kind: "clear" };
  if (mode === "keyword") return { kind: "run", searches: [{ type: "lex", query }] };
  // hybrid:
  if (trigger === "input") return { kind: "none" }; // wait for Enter
  return { kind: "run", searches: [{ type: "lex", query }, { type: "vec", query }] };
}
