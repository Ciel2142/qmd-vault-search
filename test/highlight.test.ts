import { describe, it, expect } from "vitest";
import { queryTerms, highlightTerms } from "../src/highlight";

describe("queryTerms", () => {
  it("splits on whitespace, drops empties, lowercases, de-dupes", () => {
    expect(queryTerms("  Foo  bar foo ")).toEqual(["foo", "bar"]);
  });
  it("returns [] for blank input", () => {
    expect(queryTerms("   ")).toEqual([]);
  });
  it("returns [] for an empty string", () => {
    expect(queryTerms("")).toEqual([]);
  });
});

describe("highlightTerms", () => {
  it("returns one non-hit segment when there are no terms", () => {
    expect(highlightTerms("hello world", [])).toEqual([{ text: "hello world", hit: false }]);
  });
  it("marks case-insensitive hits and rejoins to the original text", () => {
    const segs = highlightTerms("Embedding models are fast", ["embedding"]);
    expect(segs.map((s) => s.text).join("")).toBe("Embedding models are fast");
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["Embedding"]);
  });
  it("highlights multiple terms", () => {
    const segs = highlightTerms("embedding models", ["embedding", "models"]);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["embedding", "models"]);
  });
  it("escapes regex-special characters in terms", () => {
    const segs = highlightTerms("value a.b and axb", ["a.b"]);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["a.b"]);
  });
  it("returns one non-hit segment when nothing matches", () => {
    expect(highlightTerms("nothing here", ["zzz"])).toEqual([{ text: "nothing here", hit: false }]);
  });
  it("prefers the longest term when terms overlap as prefixes", () => {
    const segs = highlightTerms("embedding", ["em", "embedding"]);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["embedding"]);
  });
  it("is stable on empty text", () => {
    expect(highlightTerms("", [])).toEqual([{ text: "", hit: false }]);
    expect(highlightTerms("", ["foo"])).toEqual([]);
  });
});
