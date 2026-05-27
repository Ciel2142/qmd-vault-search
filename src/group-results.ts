import type { QmdSearchResult } from "./qmd-client";
import { resolveOpenTarget, type OpenTarget } from "./open-target";
import { cleanSnippet } from "./clean-snippet";

export interface ResultMatch {
  line: number;
  docid: string;
  context: string;
}

export interface FileGroup {
  key: string;        // group identity for collapse state — the collection-relative `file`
  target: OpenTarget; // resolved once per file
  title: string;      // r.title || filename(file)
  tag: string;        // "vault" for vault files; else the collection prefix (first path segment)
  matches: ResultMatch[];
}

/** Group ranked qmd results by file, preserving first-appearance order. Pure. */
export function groupResults(
  results: QmdSearchResult[],
  resolveVaultPath: (collectionRelativePath: string) => string | null,
  vaultCollectionName: string,
): FileGroup[] {
  const byFile = new Map<string, FileGroup>();
  for (const result of results) {
    let group = byFile.get(result.file);
    if (!group) {
      const target = resolveOpenTarget(result.file, result.docid, resolveVaultPath, vaultCollectionName);
      group = {
        key: result.file,
        target,
        title: result.title || (result.file.split("/").pop() ?? result.file),
        tag: target.kind === "vault" ? "vault" : (result.file.split("/")[0] ?? result.file),
        matches: [],
      };
      byFile.set(result.file, group);
    }
    group.matches.push({ line: result.line, docid: result.docid, context: cleanSnippet(result.snippet) });
  }
  return [...byFile.values()];
}
