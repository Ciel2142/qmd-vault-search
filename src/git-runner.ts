import type { SpawnOptions, ChildProcess } from "node:child_process";

export interface GitRunResult { code: number; stdout: string; stderr: string }
export type RunGit = (args: string[]) => Promise<GitRunResult>;

export interface MakeRunGitDeps {
  spawn: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
  cwd: string;
}

/** Serialized-by-caller git CLI runner. Argv only (no shell). Never throws. */
export function makeRunGit(deps: MakeRunGitDeps): RunGit {
  return (args) =>
    new Promise((resolve) => {
      const child = deps.spawn("git", args, { stdio: ["ignore", "pipe", "pipe"], cwd: deps.cwd });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => resolve({ code: -1, stdout, stderr: String(e) }));
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}
