import type { QmdClient, QmdSearchResult } from "./qmd-client";

/** Drop YAML frontmatter, collapse whitespace, truncate to maxChars. */
export function buildExcerpt(content: string, maxChars = 1500): string {
  let body = content;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  body = body.replace(/\s+/g, " ").trim();
  return body.slice(0, maxChars);
}

export interface DeriveNeighborsOptions {
  content: string;
  collections: string[];
  selfFile?: string;
  limit: number;
  minScore: number;
}

/** Doc→doc neighbors via a vec query built from the source note's excerpt. */
export async function deriveNeighbors(client: QmdClient, opts: DeriveNeighborsOptions): Promise<QmdSearchResult[]> {
  const excerpt = buildExcerpt(opts.content);
  const results = await client.query({
    searches: [{ type: "vec", query: excerpt }],
    collections: opts.collections,
    rerank: false,
    minScore: opts.minScore,
    limit: opts.limit + 1, // headroom to drop self
  });
  return results.filter((r) => r.file !== opts.selfFile).slice(0, opts.limit);
}
