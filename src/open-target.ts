export type OpenTarget =
  | { kind: "vault"; path: string }
  | { kind: "external"; file: string; docid: string };

/** qmd reports collection-prefixed paths (`vault/notes/x.md`); a vault file lives at the un-prefixed Obsidian path (`notes/x.md`). Strip the vault collection prefix. */
export function toVaultPath(file: string, vaultCollectionName: string): string {
  const prefix = `${vaultCollectionName}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

/**
 * Map a qmd result to an open target. qmd both prefixes paths with the collection
 * name AND runs each path through `handelize()` (`vault/My Note.md` → `vault/My-Note.md`,
 * underscores/punctuation/dots collapse to hyphens too — see vault-resolver.ts), so we
 * strip the prefix then ask `resolveVaultPath` to reverse the slug to the real vault path.
 * If it resolves, open it there; otherwise it's an external-collection doc.
 */
export function resolveOpenTarget(
  file: string,
  docid: string,
  resolveVaultPath: (collectionRelativePath: string) => string | null,
  vaultCollectionName: string,
): OpenTarget {
  const realPath = resolveVaultPath(toVaultPath(file, vaultCollectionName));
  return realPath !== null ? { kind: "vault", path: realPath } : { kind: "external", file, docid };
}
