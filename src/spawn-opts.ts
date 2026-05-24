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
