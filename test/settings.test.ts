import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, baseUrl } from "../src/settings";

describe("settings", () => {
  it("defaults vault collection to 'vault' and port 8181", () => {
    expect(DEFAULT_SETTINGS.vaultCollectionName).toBe("vault");
    expect(DEFAULT_SETTINGS.daemonPort).toBe(8181);
    expect(DEFAULT_SETTINGS.rerank).toBe(true);
  });
  it("defaults relatedTopK to 8", () => {
    expect(DEFAULT_SETTINGS.relatedTopK).toBe(8);
  });
  it("defaults search-mode fields", () => {
    expect(DEFAULT_SETTINGS.searchMode).toBe("hybrid");
    expect(DEFAULT_SETTINGS.searchDebounceMs).toBe(300);
    expect(DEFAULT_SETTINGS.fallbackOnFailure).toBe(true);
    expect(DEFAULT_SETTINGS.fallbackOnZero).toBe(false);
  });
  it("builds base URL from port", () => {
    expect(baseUrl({ ...DEFAULT_SETTINGS, daemonPort: 9000 })).toBe("http://localhost:9000");
  });
});
