export type OpenTarget =
  | { kind: "vault"; path: string }
  | { kind: "external"; file: string; docid: string };

/** A result is openable in Obsidian iff its collection-relative path exists in the vault. */
export function resolveOpenTarget(
  file: string,
  docid: string,
  isVaultFile: (path: string) => boolean,
): OpenTarget {
  return isVaultFile(file) ? { kind: "vault", path: file } : { kind: "external", file, docid };
}
