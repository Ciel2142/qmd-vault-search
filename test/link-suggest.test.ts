import { describe, it, expect } from "vitest";
import { parseLinkTrigger, planLinkQuery } from "../src/link-suggest";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("parseLinkTrigger", () => {
  it("matches a fresh [[? at the line start", () => {
    expect(parseLinkTrigger("[[?neural")).toEqual({ query: "neural", startCh: 0 });
  });

  it("matches mid-line and reports the column of the opening [", () => {
    expect(parseLinkTrigger("foo [[?net")).toEqual({ query: "net", startCh: 4 });
  });

  it("matches an empty query right after [[?", () => {
    expect(parseLinkTrigger("[[?")).toEqual({ query: "", startCh: 0 });
  });

  it("does not match plain [[ (the built-in suggester owns it)", () => {
    expect(parseLinkTrigger("[[foo")).toBeNull();
  });

  it("does not match a closed [[?x]] with the cursor past the ]]", () => {
    expect(parseLinkTrigger("[[?x]]")).toBeNull();
  });

  it("does not match when the partial contains a bracket", () => {
    // The `[` is excluded from the partial, so `$` is never reached → no trigger.
    expect(parseLinkTrigger("[[?a[b")).toBeNull();
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
