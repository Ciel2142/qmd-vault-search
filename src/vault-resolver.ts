import { App, TFile } from "obsidian";

/**
 * Resolve a qmd collection-relative path to the real vault path, or null if it's
 * not a vault file. qmd slugs spaces to hyphens in result paths (`My Note.md` →
 * `My-Note.md`), so an exact lookup misses files with spaces. We try the exact
 * path first, then a map keyed by each vault file's slugged form. Only spaces are
 * converted on both sides, so real hyphens (e.g. a `qmd-smoke/` folder) still match.
 */
export function makeVaultResolver(app: App): (collectionRelativePath: string) => string | null {
  const bySlug = new Map<string, string>();
  for (const f of app.vault.getMarkdownFiles()) bySlug.set(f.path.replace(/ /g, "-"), f.path);
  return (p) => {
    if (app.vault.getAbstractFileByPath(p) instanceof TFile) return p;
    return bySlug.get(p) ?? null;
  };
}
