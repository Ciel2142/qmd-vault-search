import { spawn } from "node:child_process";
import type { RunQmd } from "./indexer";

/** Build a serialized-by-caller qmd CLI runner. Captures stdout/stderr, never throws. */
export function makeRunQmd(binaryPath: string): RunQmd {
  return (args) =>
    new Promise((resolve) => {
      const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => resolve({ code: -1, stdout, stderr: String(e) }));
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}
