import { stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";

/** Return true iff the vault's git repo is mid-merge / mid-rebase. */
export async function isMergeInProgress(vaultPath: string): Promise<boolean> {
  const gitDir = await resolveGitDir(vaultPath);
  if (!gitDir) return false;
  const markers = ["MERGE_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply"];
  for (const m of markers) {
    if (existsSync(join(gitDir, m))) return true;
  }
  return false;
}

/** Resolve the actual gitdir for a working tree. Handles `.git` as a dir or as a `gitdir:` pointer file. */
export async function resolveGitDir(vaultPath: string): Promise<string | null> {
  const dotGit = join(vaultPath, ".git");
  let st;
  try { st = await stat(dotGit); } catch { return null; }
  if (st.isDirectory()) return dotGit;
  if (st.isFile()) {
    const text = await readFile(dotGit, "utf8");
    const m = text.match(/^gitdir:\s*(.+?)\s*$/m);
    if (!m) return null;
    const p = m[1];
    return isAbsolute(p) ? p : resolve(vaultPath, p);
  }
  return null;
}
