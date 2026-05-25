import { describe, it, expect, vi } from "vitest";
import { buildExcerpt, deriveNeighbors } from "../src/neighbors";

describe("buildExcerpt", () => {
  it("strips YAML frontmatter and truncates", () => {
    const md = "---\ntags: a\n---\n# Title\n" + "x".repeat(5000);
    const ex = buildExcerpt(md, 100);
    expect(ex.startsWith("# Title")).toBe(true);
    expect(ex.length).toBeLessThanOrEqual(100);
  });
});

describe("deriveNeighbors", () => {
  it("queries by excerpt and excludes self by file", async () => {
    const client = { query: vi.fn(async () => [
      { docid: "#self", file: "notes/me.md", title: "Me", score: 1, context: null, line: 1, snippet: "" },
      { docid: "#a", file: "docs/a.md", title: "A", score: 0.8, context: null, line: 1, snippet: "" },
    ]) };
    const out = await deriveNeighbors(client as never, { content: "hello body", collections: ["vault", "docs"], selfFile: "notes/me.md", limit: 5, minScore: 0.3 });
    expect(out.map((r) => r.file)).toEqual(["docs/a.md"]);
    expect(client.query).toHaveBeenCalledWith(expect.objectContaining({
      searches: [{ type: "vec", query: "hello body" }], collections: ["vault", "docs"], rerank: false, minScore: 0.3, limit: 6,
    }));
  });
});
