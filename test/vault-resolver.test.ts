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

  // qmd's handelize() (qmd/src/store.ts) replaces EVERY run of non-(letter|digit|$)
  // with a single hyphen — not just spaces. These reverse-map qmd's real output back
  // to the source file; before the handelize port they were silently dropped (the
  // "@@ no reaction on Cyrillic / spaces / punctuation" bug).
  it("reverses an underscore slug (qmd turns _ into a hyphen)", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/my_note.md"]));
    expect(resolve("notes/my-note.md")).toBe("notes/my_note.md");
  });

  it("collapses a run of multiple spaces to one hyphen", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/My  Note.md"]));
    expect(resolve("notes/My-Note.md")).toBe("notes/My  Note.md");
  });

  it("collapses ' - ' (space-hyphen-space) to one hyphen", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/A - B.md"]));
    expect(resolve("notes/A-B.md")).toBe("notes/A - B.md");
  });

  it("reverses a Cyrillic name with punctuation (the headline case)", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/Идеи (черновик).md"]));
    expect(resolve("notes/Идеи-черновик.md")).toBe("notes/Идеи (черновик).md");
  });

  it("turns a dot inside the stem into a hyphen (extension still preserved)", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/v1.2 spec.md"]));
    expect(resolve("notes/v1-2-spec.md")).toBe("notes/v1.2 spec.md");
  });

  it("turns an apostrophe into a hyphen", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/Don't Panic.md"]));
    expect(resolve("notes/Don-t-Panic.md")).toBe("notes/Don't Panic.md");
  });

  it("converts emoji to hex codepoints (qmd emojiToHex)", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/🐘 zoo.md"]));
    expect(resolve("notes/1f418-zoo.md")).toBe("notes/🐘 zoo.md");
  });

  // handelize is many-to-one: "A b.md" and "A_b.md" both slug to "A-b.md", and neither
  // IS the slug path, so the slug is inherently ambiguous. qmd stores one file per slug
  // and we can't know which; the resolver must at least be DETERMINISTIC (independent of
  // getMarkdownFiles() enumeration order) instead of silently last-write-wins. Pin the
  // documented choice: the lexicographically-first vault path wins.
  it("resolves a colliding slug deterministically regardless of vault enumeration order", () => {
    const forward = makeVaultResolver(fakeApp(["notes/A b.md", "notes/A_b.md"]));
    const reversed = makeVaultResolver(fakeApp(["notes/A_b.md", "notes/A b.md"]));
    // " " (0x20) < "_" (0x5F), so "notes/A b.md" is lexicographically first.
    expect(forward("notes/A-b.md")).toBe("notes/A b.md");
    expect(reversed("notes/A-b.md")).toBe("notes/A b.md");
  });
});
