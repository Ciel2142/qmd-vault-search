import { describe, it, expect } from "vitest";
import { planModalSearch } from "../src/modal-query";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("planModalSearch", () => {
  const settings = { ...DEFAULT_SETTINGS, vaultCollectionName: "vault", externalCollections: ["docs"], rerank: true };

  it("clears on an empty / whitespace query", () => {
    expect(planModalSearch("hybrid", "   ", settings)).toEqual({ kind: "clear" });
  });

  it("keyword mode: lex only, rerank off, across all collections", () => {
    expect(planModalSearch("keyword", "foo", settings)).toEqual({
      kind: "run",
      searches: [{ type: "lex", query: "foo" }],
      rerank: false,
      collections: ["vault", "docs"],
    });
  });

  it("hybrid mode: lex+vec live, rerank from settings, all collections", () => {
    expect(planModalSearch("hybrid", "foo", settings)).toEqual({
      kind: "run",
      searches: [{ type: "lex", query: "foo" }, { type: "vec", query: "foo" }],
      rerank: true,
      collections: ["vault", "docs"],
    });
  });

  it("hybrid mode honours rerank:false from settings", () => {
    const plan = planModalSearch("hybrid", "foo", { ...settings, rerank: false });
    expect(plan.kind === "run" && plan.rerank).toBe(false);
  });
});
