import { describe, it, expect } from "vitest";
import { resolveOpenTarget } from "../src/open-target";

describe("resolveOpenTarget", () => {
  // Reverses qmd's collection prefix + space→hyphen slug back to the real vault path (or null if not in vault).
  const resolve = (p: string): string | null => {
    if (p === "notes/x.md") return "notes/x.md";
    if (p === "notes/My-Note.md") return "notes/My Note.md"; // slugged → real (space restored)
    return null;
  };

  it("strips the collection prefix and resolves to the real vault path", () => {
    expect(resolveOpenTarget("vault/notes/x.md", "#a1", resolve, "vault")).toEqual({ kind: "vault", path: "notes/x.md" });
  });

  it("reverses qmd's space→hyphen slug to the real (spaced) vault path", () => {
    expect(resolveOpenTarget("vault/notes/My-Note.md", "#a2", resolve, "vault")).toEqual({ kind: "vault", path: "notes/My Note.md" });
  });

  it("routes unresolved (external-collection) paths to 'external' with docid", () => {
    expect(resolveOpenTarget("docs/y.md", "#b2", resolve, "vault")).toEqual({ kind: "external", file: "docs/y.md", docid: "#b2" });
  });
});
