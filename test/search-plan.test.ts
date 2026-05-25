import { describe, it, expect } from "vitest";
import { planQuery } from "../src/search-plan";

describe("planQuery", () => {
  it("clears on empty query regardless of trigger/mode", () => {
    expect(planQuery("input", "keyword", "")).toEqual({ kind: "clear" });
    expect(planQuery("enter", "hybrid", "   ")).toEqual({ kind: "clear" });
  });

  it("runs lex-only in keyword mode (both triggers)", () => {
    expect(planQuery("input", "keyword", "foo")).toEqual({ kind: "run", searches: [{ type: "lex", query: "foo" }] });
    expect(planQuery("enter", "keyword", "foo")).toEqual({ kind: "run", searches: [{ type: "lex", query: "foo" }] });
  });

  it("does nothing on input in hybrid mode (waits for Enter)", () => {
    expect(planQuery("input", "hybrid", "foo")).toEqual({ kind: "none" });
  });

  it("runs lex+vec on Enter in hybrid mode", () => {
    expect(planQuery("enter", "hybrid", "foo")).toEqual({
      kind: "run",
      searches: [{ type: "lex", query: "foo" }, { type: "vec", query: "foo" }],
    });
  });
});
