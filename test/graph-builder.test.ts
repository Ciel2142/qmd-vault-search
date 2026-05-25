import { describe, it, expect } from "vitest";
import { buildEgoGraph } from "../src/graph-builder";

describe("buildEgoGraph", () => {
  it("makes a center node + one edge per neighbor, tagged by collection kind", () => {
    const neighbors = [
      { docid: "#a", file: "notes/a.md", title: "A", score: 0.9, context: null, line: 1, snippet: "" },
      { docid: "#b", file: "docs/b.md", title: "B", score: 0.7, context: null, line: 1, snippet: "" },
    ];
    const g = buildEgoGraph({ id: "center", label: "Me", file: "notes/me.md" }, neighbors, (p) => p.startsWith("notes/"));
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes[0]).toMatchObject({ id: "center", collectionKind: "vault" });
    expect(g.nodes.find((n) => n.id === "#b")).toMatchObject({ collectionKind: "external" });
    expect(g.edges).toEqual([
      { source: "center", target: "#a", weight: 0.9 },
      { source: "center", target: "#b", weight: 0.7 },
    ]);
  });
});
