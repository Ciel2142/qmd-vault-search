import { describe, it, expect } from "vitest";
import { platformSpawnOptions, shellQuoteArg } from "../src/spawn-opts";

describe("platformSpawnOptions", () => {
  it("returns base options unchanged on non-Windows", () => {
    expect(platformSpawnOptions({ detached: true, stdio: "ignore" }, "linux")).toEqual({ detached: true, stdio: "ignore" });
    expect(platformSpawnOptions({ stdio: ["ignore", "pipe", "pipe"] }, "darwin")).toEqual({ stdio: ["ignore", "pipe", "pipe"] });
  });
  it("adds shell + windowsHide on win32, preserving base options", () => {
    expect(platformSpawnOptions({ detached: true, stdio: "ignore" }, "win32")).toEqual({ detached: true, stdio: "ignore", shell: true, windowsHide: true });
  });
});

describe("shellQuoteArg", () => {
  it("quotes a win32 arg containing spaces (the shell:true split bug)", () => {
    // Vault path with a space — Obsidian's default "Obsidian Vault" — must survive cmd.exe arg splitting.
    expect(shellQuoteArg("C:\\Users\\igi21\\OneDrive\\Документы\\Obsidian Vault", "win32"))
      .toBe('"C:\\Users\\igi21\\OneDrive\\Документы\\Obsidian Vault"');
  });
  it("leaves win32 args without whitespace unchanged", () => {
    expect(shellQuoteArg("qmd", "win32")).toBe("qmd");
    expect(shellQuoteArg("**/*.md", "win32")).toBe("**/*.md");
    expect(shellQuoteArg("vault_obsidian_vault", "win32")).toBe("vault_obsidian_vault");
  });
  it("quotes an empty win32 arg so it survives as a token", () => {
    expect(shellQuoteArg("", "win32")).toBe('""');
  });
  it("never quotes off win32 (no shell, spaces handled natively)", () => {
    expect(shellQuoteArg("/home/u/Obsidian Vault", "linux")).toBe("/home/u/Obsidian Vault");
    expect(shellQuoteArg("", "darwin")).toBe("");
  });
});
