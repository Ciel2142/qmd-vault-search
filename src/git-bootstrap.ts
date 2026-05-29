import { readdir } from "node:fs/promises";
import type { RunGit } from "./git-runner";

export interface ValidateResult { ok: boolean; error?: string }
export interface BootstrapResult { ok: boolean; error?: string; step?: "init" | "remote" | "fetch" | "reset" }

export interface BootstrapDeps {
  vaultPath: string;
  remoteUrl: string;
  branch: string;
  runGit: RunGit; // MUST be cwd-bound to vaultPath, e.g. makeRunGit({ spawn, cwd: vaultPath })
}

const IGNORED = new Set([".obsidian"]);
const MAX_OFFENDING = 10;

const URL_RE = /^(?:https?:\/\/[^\s;&|`$()<>]+|ssh:\/\/[^\s;&|`$()<>]+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s;&|`$()<>]+|git:\/\/[^\s;&|`$()<>]+)$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

export function validateRemoteUrl(url: string): ValidateResult {
  if (!url || !URL_RE.test(url) || url.includes("..")) return { ok: false, error: "Invalid remote URL." };
  return { ok: true };
}

export function validateBranch(branch: string): ValidateResult {
  if (!branch || !BRANCH_RE.test(branch) || branch.includes("..")) return { ok: false, error: "Invalid branch name." };
  return { ok: true };
}

export async function isVaultEmpty(vaultPath: string): Promise<{ empty: boolean; offending: string[] }> {
  const entries = await readdir(vaultPath);
  const offending = entries.filter((e) => !IGNORED.has(e)).slice(0, MAX_OFFENDING);
  return { empty: offending.length === 0, offending };
}

export async function bootstrapVault(deps: BootstrapDeps): Promise<BootstrapResult> {
  const urlCheck = validateRemoteUrl(deps.remoteUrl);
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error };
  const branchCheck = validateBranch(deps.branch);
  if (!branchCheck.ok) return { ok: false, error: branchCheck.error };

  const probe = await isVaultEmpty(deps.vaultPath);
  if (!probe.empty) {
    return { ok: false, error: `Vault is not empty. Found: ${probe.offending.join(", ")}` };
  }

  const steps: { name: BootstrapResult["step"]; argv: string[] }[] = [
    { name: "init", argv: ["init"] },
    { name: "remote", argv: ["remote", "add", "origin", deps.remoteUrl] },
    { name: "fetch", argv: ["fetch", "origin", deps.branch] },
    { name: "reset", argv: ["reset", "--hard", `origin/${deps.branch}`] },
  ];

  for (const step of steps) {
    const r = await deps.runGit(step.argv);
    if (r.code === -1 && /enoent/i.test(r.stderr)) {
      return { ok: false, error: "git CLI not found. Install git and ensure it's on your PATH.", step: step.name };
    }
    if (r.code !== 0) {
      return { ok: false, error: r.stderr.trim() || `git ${step.argv.join(" ")} exited with code ${r.code}`, step: step.name };
    }
  }

  return { ok: true };
}
