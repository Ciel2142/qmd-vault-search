import { describe, it, expect } from "vitest";
import { groupResults } from "../src/group-results";
import type { QmdSearchResult } from "../src/qmd-client";

function r(over: Partial<QmdSearchResult>): QmdSearchResult {
  return { docid: "#d", file: "vault/a.md", title: "A", score: 1, context: null, line: 1, snippet: "1: text", ...over };
}
// qmd strips the "vault/" prefix before calling the resolver (see resolveOpenTarget).
const vaultResolver = (p: string): string | null => (p === "notes/a.md" ? "notes/a.md" : null);

describe("groupResults", () => {
  it("groups multiple matches from one file into one group, in order, cleaning snippets", () => {
    const results = [
      r({ file: "vault/notes/a.md", docid: "#1", line: 12, snippet: "12: first hit" }),
      r({ file: "vault/notes/a.md", docid: "#2", line: 47, snippet: "47: second hit" }),
    ];
    const groups = groupResults(results, vaultResolver, "vault");
    expect(groups).toHaveLength(1);
    expect(groups[0].matches.map((m) => m.line)).toEqual([12, 47]);
    expect(groups[0].matches[0].context).toBe("first hit");
  });

  it("orders groups by first appearance (A, B, A -> [A, B])", () => {
    const results = [
      r({ file: "vault/a.md", docid: "#1" }),
      r({ file: "vault/b.md", docid: "#2" }),
      r({ file: "vault/a.md", docid: "#3" }),
    ];
    const groups = groupResults(results, () => null, "vault");
    expect(groups.map((g) => g.key)).toEqual(["vault/a.md", "vault/b.md"]);
    expect(groups[0].matches).toHaveLength(2);
  });

  it("splits vault vs external by the resolver and tags accordingly", () => {
    const results = [
      r({ file: "vault/notes/a.md", docid: "#1" }),
      r({ file: "crawl4ai-docs/embeddings.md", docid: "#2", title: "Embeddings" }),
    ];
    const groups = groupResults(results, vaultResolver, "vault");
    expect(groups[0].target.kind).toBe("vault");
    expect(groups[0].tag).toBe("vault");
    expect(groups[1].target.kind).toBe("external");
    expect(groups[1].tag).toBe("crawl4ai-docs");
  });

  it("falls back to the filename when title is empty", () => {
    const groups = groupResults([r({ file: "vault/notes/a.md", title: "" })], vaultResolver, "vault");
    expect(groups[0].title).toBe("a.md");
  });

  it("returns [] for no results", () => {
    expect(groupResults([], vaultResolver, "vault")).toEqual([]);
  });

  it("threads score into each match and exposes the file's top score", () => {
    const results = [
      r({ file: "vault/a.md", docid: "#1", score: 0.42 }),
      r({ file: "vault/a.md", docid: "#2", score: 0.81 }),
    ];
    const groups = groupResults(results, () => null, "vault");
    expect(groups[0].matches.map((m) => m.score)).toEqual([0.42, 0.81]);
    expect(groups[0].topScore).toBe(0.81);
  });
});
