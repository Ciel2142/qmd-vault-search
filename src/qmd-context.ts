import type { RunQmd } from "./indexer";

export interface ContextEntry {
  collection: string;
  path: string; // "" for the collection root
  context: string;
}

export interface QmdResult {
  ok: boolean;
  error?: string;
}

/** Build the qmd virtual path for a vault file/folder. Root folder → collection root. */
export function vaultVirtualPath(collection: string, relPath: string, isRoot: boolean): string {
  return isRoot ? `qmd://${collection}/` : `qmd://${collection}/${relPath}`;
}
