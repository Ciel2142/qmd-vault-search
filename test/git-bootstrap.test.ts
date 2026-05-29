import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapVault, isVaultEmpty, validateRemoteUrl, validateBranch } from "../src/git-bootstrap";

let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "qmd-bs-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("validateRemoteUrl", () => {
  it.each([
    ["https://github.com/u/r.git", true],
    ["http://example.com/r.git", true],
    ["git@github.com:u/r.git", true],
    ["ssh://git@host/u/r.git", true],
    ["", false],
    ["not a url", false],
    ["https://host/r.git; rm -rf /", false],
    ["https://host/r.git && evil", false],
  ])("validateRemoteUrl(%j) → %j", (url, ok) => {
    expect(validateRemoteUrl(url).ok).toBe(ok);
  });
});

describe("validateBranch", () => {
  it.each([
    ["main", true], ["dev", true], ["feature/x", true], ["release-1.2", true],
    ["", false], ["..", false], ["with space", false], ["bad;name", false],
    ["-main", false], ["--upload-pack=evil", false],
  ])("validateBranch(%j) → %j", (b, ok) => {
    expect(validateBranch(b).ok).toBe(ok);
  });
});

describe("isVaultEmpty", () => {
  it("returns empty when only .obsidian/ exists", async () => {
    mkdirSync(join(root, ".obsidian"));
    const r = await isVaultEmpty(root);
    expect(r.empty).toBe(true);
  });

  it("returns non-empty with offending paths when any other file exists", async () => {
    mkdirSync(join(root, ".obsidian"));
    writeFileSync(join(root, "note.md"), "hi");
    mkdirSync(join(root, "subdir"));
    const r = await isVaultEmpty(root);
    expect(r.empty).toBe(false);
    expect(r.offending).toContain("note.md");
    expect(r.offending).toContain("subdir");
  });

  it("caps offending list at 10 entries", async () => {
    for (let i = 0; i < 20; i++) writeFileSync(join(root, `f${i}.md`), "");
    const r = await isVaultEmpty(root);
    expect(r.empty).toBe(false);
    expect(r.offending.length).toBe(10);
  });
});

describe("bootstrapVault", () => {
  it("refuses non-empty vaults without invoking git", async () => {
    writeFileSync(join(root, "preexisting.md"), "hello");
    const runGit = vi.fn();
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "https://h/r.git", branch: "main", runGit });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not empty");
    expect(runGit).not.toHaveBeenCalled();
  });

  it("rejects bad URL before invoking git", async () => {
    const runGit = vi.fn();
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "bad url", branch: "main", runGit });
    expect(result.ok).toBe(false);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("rejects bad branch before invoking git", async () => {
    const runGit = vi.fn();
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "https://h/r.git", branch: "bad branch", runGit });
    expect(result.ok).toBe(false);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("runs init, remote add, fetch, reset --hard in order for empty vault", async () => {
    const calls: string[][] = [];
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    });
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "https://h/r.git", branch: "main", runGit });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ["init"],
      ["remote", "add", "origin", "https://h/r.git"],
      ["fetch", "origin", "main"],
      ["reset", "--hard", "origin/main"],
    ]);
  });

  it("stops on first non-zero exit and returns stderr", async () => {
    const runGit = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 128, stdout: "", stderr: "fatal: Authentication failed" });
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "https://h/r.git", branch: "main", runGit });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Authentication failed");
    expect(runGit).toHaveBeenCalledTimes(3);
  });

  it("treats ENOENT (code=-1) as git-not-installed", async () => {
    const runGit = vi.fn().mockResolvedValue({ code: -1, stdout: "", stderr: "Error: spawn git ENOENT" });
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "https://h/r.git", branch: "main", runGit });
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("git cli not found");
  });
});
