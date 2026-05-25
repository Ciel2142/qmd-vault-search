/**
 * Turn qmd's raw query snippet into clean prose for display in the panel.
 *
 * qmd renders each snippet line as `NN: <content>` (1-indexed source line),
 * preceded by a diff-style hunk header `@@ -start,count @@ (n before, m after)`
 * (see qmd/src/store.ts). That format is useful to qmd's CLI/MCP consumers but
 * is noise in the GUI. This strips the line-number prefixes, the hunk header,
 * and blank lines (the "blank blocks"), and lightly de-markdowns the text
 * (leading heading markers, `[[wikilink|alias]]` -> alias). Pure; no obsidian.
 */
export function cleanSnippet(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\d+:\s?/, "")) // drop qmd's "NN: " line-number prefix
    .filter((line) => !/^@@ -\d+,\d+ @@/.test(line)) // drop the diff hunk header
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "") // drop leading markdown heading markers
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => alias ?? target),
    ) // [[a|b]] -> b, [[a]] -> a
    .filter((line) => line.trim() !== "") // drop blank lines (the "blank blocks")
    .join("\n");
}
