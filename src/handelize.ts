/**
 * Faithful port of qmd's `handelize()` (qmd `src/store.ts`). qmd runs every indexed
 * path through this before storing it, and search results report that slugged path.
 * The vault resolver reverse-maps a qmd result path back to the real vault file by
 * re-deriving this exact slug, so this MUST stay byte-for-byte equivalent to qmd's
 * rule — any drift silently drops hits (the "@@ no reaction on Cyrillic / spaces /
 * punctuation" class of bug).
 *
 * Rule: per path segment, replace every run of non-(unicode letter | unicode digit |
 * "$") with a single hyphen and trim leading/trailing hyphens; the filename's
 * extension is preserved; emoji become their hex codepoints; "___" is a folder
 * separator. Case and unicode letters (incl. Cyrillic) are preserved.
 */

function emojiToHex(str: string): string {
  return str.replace(/(?:\p{So}\p{Mn}?|\p{Sk})+/gu, (run) => {
    // Split the run into individual emoji and convert each to hex, dash-separated.
    return [...run]
      .filter((c) => /\p{So}|\p{Sk}/u.test(c))
      .map((c) => c.codePointAt(0)!.toString(16))
      .join("-");
  });
}

export function handelize(path: string): string {
  if (!path || path.trim() === "") {
    throw new Error("handelize: path cannot be empty");
  }

  // Allow route-style "$" filenames while still rejecting paths with no usable content.
  // Emoji (\p{So}) counts as valid content — they get converted to hex codepoints below.
  const segments = path.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1] || "";
  const filenameWithoutExt = lastSegment.replace(/\.[^.]+$/, "");
  const hasValidContent = /[\p{L}\p{N}\p{So}\p{Sk}$]/u.test(filenameWithoutExt);
  if (!hasValidContent) {
    throw new Error(`handelize: path "${path}" has no valid filename content`);
  }

  const result = path
    .replace(/___/g, "/") // Triple underscore becomes folder separator
    .split("/")
    .map((segment, idx, arr) => {
      const isLastSegment = idx === arr.length - 1;

      // Convert emoji to hex codepoints before cleaning.
      segment = emojiToHex(segment);

      if (isLastSegment) {
        // For the filename (last segment), preserve the extension.
        const extMatch = segment.match(/(\.[a-z0-9]+)$/i);
        const ext = extMatch ? extMatch[1] : "";
        const nameWithoutExt = ext ? segment.slice(0, -ext.length) : segment;

        const cleanedName = nameWithoutExt
          .replace(/[^\p{L}\p{N}$]+/gu, "-") // Keep letters, numbers, "$"; dash-separate rest (including dots)
          .replace(/^-+|-+$/g, ""); // Remove leading/trailing dashes

        return cleanedName + ext;
      } else {
        // For directories, just clean normally.
        return segment.replace(/[^\p{L}\p{N}$]+/gu, "-").replace(/^-+|-+$/g, "");
      }
    })
    .filter(Boolean)
    .join("/");

  if (!result) {
    throw new Error(`handelize: path "${path}" resulted in empty string after processing`);
  }

  return result;
}
