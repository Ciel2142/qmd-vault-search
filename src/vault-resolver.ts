import { App, TFile } from "obsidian";
import { handelize } from "./handelize";

/**
 * Resolve a qmd collection-relative path to the real vault path, or null if it's
 * not a vault file. qmd stores/returns paths run through `handelize()` — every run
 * of non-(letter|digit|`$`) becomes a single hyphen (spaces, punctuation, underscores,
 * dots in the stem…), case + unicode letters preserved, emoji → hex, extension kept.
 * A plain `replace(/ /g, "-")` only reversed single spaces, so any file with
 * punctuation/underscores/multiple spaces was dropped (notably Cyrillic note titles).
 * We mirror qmd's exact slug: try the exact path first, then a map keyed by each vault
 * file's handelized form.
 *
 * handelize is many-to-one (`A b.md` and `A_b.md` both slug to `A-b.md`). qmd's index
 * keeps exactly one file per slug (UNIQUE(collection, path)) and we can't know which one
 * it picked, so an ambiguous slug can't be reversed perfectly. We make the choice at
 * least DETERMINISTIC instead of dependent on `getMarkdownFiles()` order: iterate paths
 * sorted ascending and keep the first (lexicographically-first vault path wins). An exact
 * vault path always takes precedence over the slug map.
 */
export function makeVaultResolver(app: App): (collectionRelativePath: string) => string | null {
  const bySlug = new Map<string, string>();
  const paths = app.vault.getMarkdownFiles().map((f) => f.path).sort();
  for (const path of paths) {
    // handelize throws on names with no slug-able content; such a file can't be a qmd
    // result path anyway, so skip it rather than fail the whole map.
    try {
      const slug = handelize(path);
      // First (lexicographically-first) write wins; don't let a later colliding file clobber it.
      if (!bySlug.has(slug)) bySlug.set(slug, path);
    } catch {
      /* unhandelizable filename — skip */
    }
  }
  return (p) => {
    if (app.vault.getAbstractFileByPath(p) instanceof TFile) return p;
    return bySlug.get(p) ?? null;
  };
}
