import type { App } from "obsidian";
import type { QmdClient } from "./qmd-client";
import type { OpenTarget } from "./open-target";

/** Open a resolved qmd target: vault notes in the workspace, external docs in a read-only preview modal. Shared by the result list and the search modal. */
export async function openResolvedTarget(app: App, client: QmdClient, target: OpenTarget): Promise<void> {
  if (target.kind === "vault") {
    await app.workspace.openLinkText(target.path, "", false);
  } else {
    const { DocPreviewModal } = await import("./views/doc-preview");
    new DocPreviewModal(app, client, target.docid).open();
  }
}
