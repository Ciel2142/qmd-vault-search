import { MarkdownView, type App } from "obsidian";
import type { QmdClient } from "./qmd-client";
import type { OpenTarget } from "./open-target";

/** qmd's 1-indexed source line → Obsidian's 0-indexed editor line. Pure, exported for test. */
export function toEditorLine(qmdLine: number): number {
  return Math.max(0, qmdLine - 1);
}

/**
 * Open a resolved qmd target: vault notes in the workspace (optionally scrolled to a
 * line), external docs in a read-only preview modal. Shared by the result list,
 * grouped result list, and the search modal.
 */
export async function openResolvedTarget(app: App, client: QmdClient, target: OpenTarget, line?: number): Promise<void> {
  if (target.kind === "vault") {
    await app.workspace.openLinkText(target.path, "", false);
    if (line != null) app.workspace.getActiveViewOfType(MarkdownView)?.setEphemeralState({ line: toEditorLine(line) });
  } else {
    const { DocPreviewModal } = await import("./views/doc-preview");
    new DocPreviewModal(app, client, target.docid).open();
  }
}
