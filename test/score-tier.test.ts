import { describe, it, expect } from "vitest";
import { scoreTier, tierFloor, tierLabel, tierEmptyText, tiersActive, TIERS } from "../src/score-tier";

describe("scoreTier", () => {
  it("buckets at qmd thresholds (>=0.7 high, >=0.4 med, else low)", () => {
    expect(scoreTier(1)).toBe("high");
    expect(scoreTier(0.7)).toBe("high");
    expect(scoreTier(0.699)).toBe("med");
    expect(scoreTier(0.4)).toBe("med");
    expect(scoreTier(0.399)).toBe("low");
    expect(scoreTier(0)).toBe("low");
  });
});

describe("tierFloor", () => {
  it("maps a tier to the qmd minScore floor (low = no filter)", () => {
    expect(tierFloor("high")).toBe(0.7);
    expect(tierFloor("med")).toBe(0.4);
    expect(tierFloor("low")).toBe(0);
  });
});

describe("tierLabel", () => {
  it("uppercases the tier", () => {
    expect(tierLabel("high")).toBe("HIGH");
    expect(tierLabel("med")).toBe("MED");
    expect(tierLabel("low")).toBe("LOW");
  });
});

describe("tierEmptyText", () => {
  it("suggests lower tiers (only high/med ever filter to empty)", () => {
    expect(tierEmptyText("high")).toBe("No HIGH-relevance results — try MED or LOW.");
    expect(tierEmptyText("med")).toBe("No MED-relevance results — try LOW.");
  });
});

describe("tiersActive", () => {
  it("is true only for hybrid + rerank (reranked scores are 0-1)", () => {
    expect(tiersActive("hybrid", true)).toBe(true);
    expect(tiersActive("hybrid", false)).toBe(false);
    expect(tiersActive("keyword", true)).toBe(false);
    expect(tiersActive("keyword", false)).toBe(false);
  });
});

describe("TIERS", () => {
  it("lists tiers high→low for the control order", () => {
    expect(TIERS).toEqual(["high", "med", "low"]);
  });
});
