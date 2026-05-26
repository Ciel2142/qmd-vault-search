import type { QmdSubQuery } from "./qmd-client";
import type { QmdSettings } from "./settings";

export interface LinkTrigger {
  query: string;
  startCh: number;
}

/**
 * Detect the `@@<partial>` semantic-link sentinel ending at the cursor.
 * Returns the partial query + the column of the first `@`, or null when the
 * text before the cursor is not an open `@@...`. A non-`[[` trigger is used
 * because Obsidian's built-in `[[` link suggester claims any `[[...` context,
 * leaving a custom EditorSuggest no chance to show (confirmed by smoke). The
 * partial excludes `@`/`[`/`]`, so an earlier `@@` is skipped for the rightmost
 * one, a lone `@` (emails, mentions) never triggers, and a bracket aborts the
 * match (the replaced span never covers a `[`/`]`).
 */
export function parseLinkTrigger(textBeforeCursor: string): LinkTrigger | null {
  const m = /@@([^@\[\]]*)$/.exec(textBeforeCursor);
  if (!m) return null;
  return { query: m[1], startCh: m.index };
}

export type LinkQueryPlan =
  | { kind: "clear" }
  | { kind: "run"; searches: QmdSubQuery[]; collections: string[]; rerank: boolean };

/** Semantic link suggestions are always a vec query over the vault collection only. */
export function planLinkQuery(query: string, settings: QmdSettings): LinkQueryPlan {
  if (query.trim() === "") return { kind: "clear" };
  return {
    kind: "run",
    searches: [{ type: "vec", query }],
    collections: [settings.vaultCollectionName],
    rerank: false,
  };
}
