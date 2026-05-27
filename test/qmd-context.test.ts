import { describe, it, expect } from "vitest";
import { vaultVirtualPath } from "../src/qmd-context";

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
