import { describe, it, expect } from "vitest";
import { cleanSnippet } from "../src/clean-snippet";

describe("cleanSnippet", () => {
  it("strips line-number prefixes, the @@ hunk header, and blank lines", () => {
    const raw = [
      "1: @@ -1,3 @@ (0 before, 224 after)",
      "2: Decorations let you control how to draw or style content.",
      "3: ",
      "4: By the end of this page, you'll be able to:",
    ].join("\n");
    expect(cleanSnippet(raw)).toBe(
      "Decorations let you control how to draw or style content.\nBy the end of this page, you'll be able to:",
    );
  });

  it("unwraps wikilinks to their display text", () => {
    expect(cleanSnippet("2: see [[Editor extensions|editor extensions]] here")).toBe("see editor extensions here");
    expect(cleanSnippet("2: see [[Widgets]] here")).toBe("see Widgets here");
  });

  it("strips leading markdown heading markers", () => {
    expect(cleanSnippet("56: ### Widgets")).toBe("Widgets");
  });

  it("preserves content indentation (only the qmd separator space is removed)", () => {
    expect(cleanSnippet("12:     const x = 1;")).toBe("    const x = 1;");
  });

  it("returns empty string for blank or header-only input", () => {
    expect(cleanSnippet("")).toBe("");
    expect(cleanSnippet("1: @@ -1,3 @@ (0 before, 224 after)\n2: ")).toBe("");
  });

  it("leaves already-clean prose unchanged", () => {
    expect(cleanSnippet("just plain text")).toBe("just plain text");
  });
});
