import { describe, it, expect } from "vitest";
import { buildEgoGraph } from "../src/graph-builder";

describe("buildEgoGraph", () => {
  // Resolves a qmd collection-relative path to the real vault path (reversing prefix + slug), or null if external.
  const resolve = (p: string): string | null => (p === "notes/a.md" ? "notes/a.md" : p === "notes/me.md" ? "notes/me.md" : null);

  it("makes a center node + one edge per neighbor, tagged by collection kind", () => {
    const neighbors = [
      { docid: "#a", file: "vault/notes/a.md", title: "A", score: 0.9, context: null, line: 1, snippet: "" },
      { docid: "#b", file: "docs/b.md", title: "B", score: 0.7, context: null, line: 1, snippet: "" },
    ];
    const g = buildEgoGraph({ id: "center", label: "Me", file: "notes/me.md" }, neighbors, resolve, "vault");
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes[0]).toMatchObject({ id: "center", collectionKind: "vault" });
    // vault neighbor: resolved to the real path so click-to-recenter works
    expect(g.nodes.find((n) => n.id === "#a")).toMatchObject({ collectionKind: "vault", file: "notes/a.md" });
    // unresolved → external collection, left as-is
    expect(g.nodes.find((n) => n.id === "#b")).toMatchObject({ collectionKind: "external", file: "docs/b.md" });
    expect(g.edges).toEqual([
      { source: "center", target: "#a", weight: 0.9 },
      { source: "center", target: "#b", weight: 0.7 },
    ]);
  });
});
