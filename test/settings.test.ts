import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, baseUrl, deriveCollectionName, resolveVaultCollectionName } from "../src/settings";

describe("settings", () => {
  it("defaults vault collection to 'vault' and port 8181", () => {
    expect(DEFAULT_SETTINGS.vaultCollectionName).toBe("");
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

describe("deriveCollectionName", () => {
  it("slugs spaces and case", () => { expect(deriveCollectionName("My Notes")).toBe("vault_my_notes"); });
  it("slugs digits and mixed punctuation", () => { expect(deriveCollectionName("Work 2025!")).toBe("vault_work_2025"); });
  it("keeps an already-clean name", () => { expect(deriveCollectionName("already_clean")).toBe("vault_already_clean"); });
  it("trims leading/trailing separators", () => { expect(deriveCollectionName("  -Vault- ")).toBe("vault_vault"); });
  it("falls back to 'vault' when the slug is empty", () => {
    expect(deriveCollectionName("***")).toBe("vault");
    expect(deriveCollectionName("")).toBe("vault");
    expect(deriveCollectionName("日本語")).toBe("vault");
  });
});

describe("resolveVaultCollectionName", () => {
  it("keeps an explicit/persisted name", () => {
    expect(resolveVaultCollectionName({ savedName: "custom", hadSavedData: true, vaultName: "X" })).toBe("custom");
  });
  it("derives for a fresh install (no saved data)", () => {
    expect(resolveVaultCollectionName({ savedName: "", hadSavedData: false, vaultName: "My Notes" })).toBe("vault_my_notes");
  });
  it("keeps legacy 'vault' for an existing install with an empty name", () => {
    expect(resolveVaultCollectionName({ savedName: "", hadSavedData: true, vaultName: "My Notes" })).toBe("vault");
  });
});
