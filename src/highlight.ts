export interface Segment {
  text: string;
  hit: boolean;
}

/** Split a query into lowercased highlight terms: whitespace-split, drop empties, de-duplicate. */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of query.toLowerCase().split(/\s+/)) {
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Segment `text` into hit / non-hit runs against `terms` (case-insensitive).
 * Empty `terms` → a single non-hit segment. Regex-special chars in terms are escaped.
 * Segments always rejoin to the original text (no gaps, no overlaps).
 * Longer terms take precedence over shorter ones when terms overlap (e.g. "embedding" beats "em").
 */
export function highlightTerms(text: string, terms: string[]): Segment[] {
  if (terms.length === 0) return [{ text, hit: false }];
  const ordered = [...terms].sort((a, b) => b.length - a.length);
  const re = new RegExp("(" + ordered.map(escapeRegExp).join("|") + ")", "gi");
  const segments: Segment[] = [];
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), hit: false });
    segments.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // guard: never loop on a zero-length match
  }
  if (last < text.length) segments.push({ text: text.slice(last), hit: false });
  return segments;
}
