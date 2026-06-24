import { spawn } from "node:child_process";
import type { RunQmd } from "./indexer";
import { platformSpawnOptions, shellQuoteArg } from "./spawn-opts";

/** Build a serialized-by-caller qmd CLI runner. Captures stdout/stderr, never throws. */
export function makeRunQmd(binaryPath: string): RunQmd {
  return (args) =>
    new Promise((resolve) => {
      // shellQuoteArg keeps spaced values (e.g. a "...\Obsidian Vault" path) atomic under the
      // win32 shell:true that platformSpawnOptions adds; it is a no-op off Windows.
      const child = spawn(shellQuoteArg(binaryPath), args.map((a) => shellQuoteArg(a)), { stdio: ["ignore", "pipe", "pipe"], ...platformSpawnOptions({}) });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => resolve({ code: -1, stdout, stderr: String(e) }));
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}
