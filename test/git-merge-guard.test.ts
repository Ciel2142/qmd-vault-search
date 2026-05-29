import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMergeInProgress } from "../src/git-merge-guard";

let root = "";

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "qmd-mg-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("isMergeInProgress", () => {
  it("returns false when .git does not exist", async () => {
    expect(await isMergeInProgress(root)).toBe(false);
  });

  it("returns false when .git is a directory but no merge state files exist", async () => {
    mkdirSync(join(root, ".git"));
    expect(await isMergeInProgress(root)).toBe(false);
  });

  it("returns true when .git/MERGE_HEAD is present", async () => {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "MERGE_HEAD"), "deadbeef\n");
    expect(await isMergeInProgress(root)).toBe(true);
  });

  it("returns true when .git/REBASE_HEAD is present", async () => {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "REBASE_HEAD"), "cafef00d\n");
    expect(await isMergeInProgress(root)).toBe(true);
  });

  it("returns true when rebase-merge or rebase-apply directory is present", async () => {
    mkdirSync(join(root, ".git", "rebase-merge"), { recursive: true });
    expect(await isMergeInProgress(root)).toBe(true);
  });

  it("resolves .git file → external gitdir and detects MERGE_HEAD there", async () => {
    const external = join(root, "external-gitdir");
    mkdirSync(external, { recursive: true });
    writeFileSync(join(external, "MERGE_HEAD"), "abc123\n");
    writeFileSync(join(root, ".git"), `gitdir: ${external}\n`);
    expect(await isMergeInProgress(root)).toBe(true);
  });
});
