/**
 * Adjust child_process spawn options per platform.
 * On Windows, qmd is installed as a `qmd.cmd` shim; Node cannot launch `.cmd`
 * without a shell (CVE-2024-27980), so we add `shell: true` (+ `windowsHide`
 * to suppress a console flash). Non-Windows platforms are unchanged.
 * NOTE: shell:true routes args through cmd.exe on Windows. All values that feed
 * spawn args (binaryPath, collection name, mask from user settings) must stay free
 * of shell metacharacters; defaults are safe and no remote/untrusted input flows here.
 */
export function platformSpawnOptions<T extends object>(
  base: T,
  platform: NodeJS.Platform = process.platform,
): T & { shell?: true; windowsHide?: true } {
  if (platform === "win32") return { ...base, shell: true, windowsHide: true };
  return base;
}

/**
 * Quote a single spawn argument for cmd.exe when shell:true is in effect (Windows .cmd shim).
 * Under shell:true Node joins the command + args into one cmd.exe line WITHOUT quoting, so any value
 * containing whitespace — e.g. a vault path like `C:\Users\me\Obsidian Vault` — splits into separate
 * tokens (qmd then sees only `C:\Users\me\Obsidian`). Wrapping it in double quotes keeps it atomic;
 * cmd.exe `/s` strips only the single outermost pair Node adds, leaving these inner quotes intact.
 * No-op off win32, where spawn passes argv elements verbatim (no shell, spaces are already safe).
 */
export function shellQuoteArg(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return arg;
  return arg === "" || /\s/.test(arg) ? `"${arg}"` : arg;
}
