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

/**
 * Build the qmd virtual path for a vault file/folder. Root folder → collection root.
 * @param relPath a non-empty vault-relative path (e.g. "Projects/note.md"); ignored when isRoot.
 */
export function vaultVirtualPath(collection: string, relPath: string, isRoot: boolean): string {
  return isRoot ? `qmd://${collection}/` : `qmd://${collection}/${relPath}`;
}

// qmd's contextList() prints a fixed layout: collection at 0-space indent, path at 2, context at 4.
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

/** Read the current context summary for a vault path, or null. Never throws. */
export async function readContext(
  runQmd: RunQmd,
  collection: string,
  relPath: string,
  isRoot: boolean,
): Promise<string | null> {
  const target = isRoot ? "" : relPath;
  // "qmd context list" takes no per-path filter, so fetch all entries and match locally.
  const res = await runQmd(["context", "list"]);
  if (res.code !== 0) return null;
  const match = parseContextList(res.stdout).find((e) => e.collection === collection && e.path === target);
  return match ? match.context : null;
}

function toResult(res: { code: number; stderr: string }): QmdResult {
  return res.code === 0 ? { ok: true } : { ok: false, error: res.stderr.trim() || `qmd exited ${res.code}` };
}

/** Add/overwrite the context summary for a virtual path. */
export async function setContext(runQmd: RunQmd, virtualPath: string, text: string): Promise<QmdResult> {
  return toResult(await runQmd(["context", "add", virtualPath, text]));
}

/** Remove the context summary for a virtual path. */
export async function removeContext(runQmd: RunQmd, virtualPath: string): Promise<QmdResult> {
  return toResult(await runQmd(["context", "rm", virtualPath]));
}
