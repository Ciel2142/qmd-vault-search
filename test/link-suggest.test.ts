import { describe, it, expect } from "vitest";
import { parseLinkTrigger, planLinkQuery } from "../src/link-suggest";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("parseLinkTrigger", () => {
  it("matches a fresh @@ at the line start", () => {
    expect(parseLinkTrigger("@@neural")).toEqual({ query: "neural", startCh: 0 });
  });

  it("matches mid-line and reports the column of the first @", () => {
    expect(parseLinkTrigger("foo @@net")).toEqual({ query: "net", startCh: 4 });
  });

  it("matches an empty query right after @@", () => {
    expect(parseLinkTrigger("@@")).toEqual({ query: "", startCh: 0 });
  });

  it("does not match a lone @ (emails, mentions)", () => {
    expect(parseLinkTrigger("@foo")).toBeNull();
  });

  it("leaves plain [[ untouched (the built-in suggester owns it)", () => {
    expect(parseLinkTrigger("[[foo")).toBeNull();
  });

  it("does not match when the partial contains a bracket", () => {
    // The partial `[^@\[\]]*` stops at the inner `[`, so the match can't reach `$` → no trigger.
    expect(parseLinkTrigger("@@a[b")).toBeNull();
  });

  it("keeps whitespace inside the partial query", () => {
    expect(parseLinkTrigger("@@foo bar")).toEqual({ query: "foo bar", startCh: 0 });
  });

  it("selects the rightmost @@ when an earlier one precedes it on the line", () => {
    // The leftmost @@ can't reach `$` (its partial stops at the next `@`), so the engine advances.
    expect(parseLinkTrigger("x @@one @@two")).toEqual({ query: "two", startCh: 8 });
  });
});

describe("planLinkQuery", () => {
  const settings = { ...DEFAULT_SETTINGS, vaultCollectionName: "vault" };

  it("clears on an empty query", () => {
    expect(planLinkQuery("", settings)).toEqual({ kind: "clear" });
  });

  it("clears on a whitespace-only query", () => {
    expect(planLinkQuery("   ", settings)).toEqual({ kind: "clear" });
  });

  it("runs a vec-only query over the vault collection, rerank off", () => {
    expect(planLinkQuery("foo", settings)).toEqual({
      kind: "run",
      searches: [{ type: "vec", query: "foo" }],
      collections: ["vault"],
      rerank: false,
    });
  });
});
