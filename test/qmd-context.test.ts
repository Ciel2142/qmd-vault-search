import { describe, it, expect } from "vitest";
import { vaultVirtualPath, parseContextList } from "../src/qmd-context";

describe("vaultVirtualPath", () => {
  it("maps a file to a virtual path", () => {
    expect(vaultVirtualPath("vault", "Projects/note.md", false)).toBe("qmd://vault/Projects/note.md");
  });
  it("maps a nested folder to a virtual path", () => {
    expect(vaultVirtualPath("vault", "Projects/Sub", false)).toBe("qmd://vault/Projects/Sub");
  });
  it("maps the vault root folder to the collection root", () => {
    expect(vaultVirtualPath("vault", "/", true)).toBe("qmd://vault/");
  });
  it("honors a custom collection name", () => {
    expect(vaultVirtualPath("notes", "a.md", false)).toBe("qmd://notes/a.md");
  });
});

const SAMPLE = [
  "",
  "Configured Contexts",
  "",
  "vault",
  "  / (root)",
  "    Whole-vault summary.",
  "  Projects/note.md",
  "    Spec for feature X.",
  "qmd",
  "  / (root)",
  "    QMD source code.",
].join("\n");

describe("parseContextList", () => {
  it("parses collections, root, and subpaths", () => {
    expect(parseContextList(SAMPLE)).toEqual([
      { collection: "vault", path: "", context: "Whole-vault summary." },
      { collection: "vault", path: "Projects/note.md", context: "Spec for feature X." },
      { collection: "qmd", path: "", context: "QMD source code." },
    ]);
  });
  it("returns [] for empty / no-context output", () => {
    expect(parseContextList("")).toEqual([]);
    expect(parseContextList("No contexts configured. Use 'qmd context add' to add one.")).toEqual([]);
  });
  it("does not throw on a malformed block (path with no following context)", () => {
    const out = ["vault", "  Orphan/path.md", "qmd", "  / (root)", "    ok"].join("\n");
    expect(parseContextList(out)).toEqual([{ collection: "qmd", path: "", context: "ok" }]);
  });
});
