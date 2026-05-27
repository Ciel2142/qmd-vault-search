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

/** Parse `qmd context list` stdout into entries. Tolerates the banner + blanks; never throws. */
export function parseContextList(stdout: string): ContextEntry[] {
  const entries: ContextEntry[] = [];
  let collection = "";
  let pendingPath: string | null = null;
  for (const raw of stdout.split("\n")) {
    if (raw.trim() === "") continue;
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (indent === 0) {
      if (text === "Configured Contexts") continue;
      if (text.startsWith("No contexts configured")) continue;
      collection = text;
      pendingPath = null;
    } else if (indent <= 2) {
      pendingPath = text === "/ (root)" ? "" : text;
    } else if (pendingPath !== null && collection) {
      entries.push({ collection, path: pendingPath, context: text });
      pendingPath = null;
    }
  }
  return entries;
}
