import { describe, it, expect } from "vitest";
import { App, TFile } from "obsidian";
import { makeVaultResolver } from "../src/vault-resolver";

// Build a fake App whose vault contains exactly `paths` as markdown files.
// makeVaultResolver reads only two vault methods:
//   getMarkdownFiles() -> TFile[]            (reads .path to build the slug map)
//   getAbstractFileByPath(p) instanceof TFile (exact-path hit detection)
// The mock's TFile is an empty class, so `instanceof TFile` works on `new TFile()`.
function fakeApp(paths: string[]): App {
  const present = new Set(paths);
  const files = paths.map((p) => Object.assign(new TFile(), { path: p }));
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (p: string) =>
        present.has(p) ? Object.assign(new TFile(), { path: p }) : null,
    },
  } as unknown as App;
}

describe("makeVaultResolver", () => {
  it("resolves an exact (un-slugged) path hit", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/x.md"]));
    expect(resolve("notes/x.md")).toBe("notes/x.md");
  });

  it("reverses qmd's space->hyphen slug back to the real spaced path", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/My Note.md"]));
    expect(resolve("notes/My-Note.md")).toBe("notes/My Note.md");
  });

  it("preserves case: a capitalized spaced file resolves from its case-preserved slug", () => {
    // Task 1 ground truth: current qmd slugs spaces->hyphens but PRESERVES case,
    // so `Costly Rituals.md` is reported as `Costly-Rituals.md` (NOT `costly-rituals.md`).
    const resolve = makeVaultResolver(fakeApp(["lore/Costly Rituals.md"]));
    expect(resolve("lore/Costly-Rituals.md")).toBe("lore/Costly Rituals.md");
  });

  it("does NOT resolve a lowercased slug (documents the case-sensitivity boundary)", () => {
    // Confirmed by Task 1: qmd preserves case (spaces become hyphens, case unchanged),
    // so this boundary test intentionally documents that the resolver is case-sensitive.
    const resolve = makeVaultResolver(fakeApp(["lore/Costly Rituals.md"]));
    expect(resolve("lore/costly-rituals.md")).toBeNull();
  });

  it("preserves real hyphens (a literal `qmd-smoke/` folder is not a slugged space)", () => {
    const resolve = makeVaultResolver(fakeApp(["qmd-smoke/note.md"]));
    expect(resolve("qmd-smoke/note.md")).toBe("qmd-smoke/note.md");
  });

  it("preserves unicode characters in the path", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/Café León.md"]));
    expect(resolve("notes/Café-León.md")).toBe("notes/Café León.md");
  });

  it("returns null for a path that is not a vault file (external collection)", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/x.md"]));
    expect(resolve("crawl4ai-docs/embeddings.md")).toBeNull();
  });
});
