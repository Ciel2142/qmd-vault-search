import { describe, it, expect } from "vitest";
import { decideFallback } from "../src/search-fallback";

const opts = (failure: boolean, zero: boolean) => ({ fallbackOnFailure: failure, fallbackOnZero: zero });

describe("decideFallback", () => {
  it("falls back on error when fallbackOnFailure is on", () => {
    expect(decideFallback({ errored: true, resultCount: 0 }, opts(true, false))).toEqual({ fallback: true, reason: "failure" });
  });

  it("does not fall back on error when fallbackOnFailure is off", () => {
    expect(decideFallback({ errored: true, resultCount: 0 }, opts(false, false))).toEqual({ fallback: false, reason: null });
  });

  it("falls back on zero results when fallbackOnZero is on", () => {
    expect(decideFallback({ errored: false, resultCount: 0 }, opts(true, true))).toEqual({ fallback: true, reason: "zero" });
  });

  it("does not fall back on zero results when fallbackOnZero is off", () => {
    expect(decideFallback({ errored: false, resultCount: 0 }, opts(true, false))).toEqual({ fallback: false, reason: null });
  });

  it("does not fall back when there are results", () => {
    expect(decideFallback({ errored: false, resultCount: 5 }, opts(true, true))).toEqual({ fallback: false, reason: null });
  });
});
