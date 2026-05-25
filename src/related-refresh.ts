/** Minimal view of the active file — deliberately NOT Obsidian's TFile, to keep this module obsidian-free + unit-testable. */
export type ActiveFileInfo = { path: string; extension: string } | null;

export type RefreshDecision =
  | { action: "skip" }                 // same note, or non-markdown → keep current
  | { action: "clear" }                // no active file → empty state
  | { action: "defer" }                // panel hidden → re-evaluated on reveal
  | { action: "render"; path: string };

/** Decide whether the Related notes panel should refresh for the current active file. */
export function shouldRefresh(activeFile: ActiveFileInfo, lastPath: string | null, visible: boolean): RefreshDecision {
  if (!activeFile) return { action: "clear" };
  if (activeFile.extension !== "md") return { action: "skip" };
  if (activeFile.path === lastPath) return { action: "skip" };
  if (!visible) return { action: "defer" };
  return { action: "render", path: activeFile.path };
}
