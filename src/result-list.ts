import { App, TFile } from "obsidian";
import type { QmdClient, QmdSearchResult } from "./qmd-client";
import { resolveOpenTarget } from "./open-target";

export interface RenderResultListOptions {
  container: HTMLElement;
  results: QmdSearchResult[];
  app: App;
  client: QmdClient;
  emptyText: string;
}

/** A result is openable in the vault iff its collection-relative path resolves to a vault TFile. */
function isVaultFile(app: App, path: string): boolean {
  return app.vault.getAbstractFileByPath(path) instanceof TFile;
}

/** Render a list of qmd results. Shared by SearchView and RelatedNotesView. */
export function renderResultList(opts: RenderResultListOptions): void {
  const { container, results, app, client, emptyText } = opts;
  container.empty();
  if (results.length === 0) {
    container.createDiv({ cls: "qmd-status", text: emptyText });
    return;
  }
  for (const r of results) {
    const row = container.createDiv({ cls: "qmd-result" });
    const target = resolveOpenTarget(r.file, r.docid, (p) => isVaultFile(app, p));
    row.createDiv({ cls: "qmd-result-title", text: r.title || r.file });
    const meta = row.createDiv({ cls: "qmd-result-meta" });
    meta.createSpan({ cls: `qmd-badge ${target.kind}`, text: target.kind === "vault" ? "vault" : "external" });
    meta.createSpan({ cls: "qmd-score", text: `${Math.round(r.score * 100)}%` });
    const graphBtn = meta.createSpan({ cls: "qmd-graph-link", text: "graph" });
    graphBtn.onclick = (ev): void => {
      ev.stopPropagation();
      app.workspace.trigger("qmd:center-graph", r.file, r.title || r.file);
    };
    row.createDiv({ cls: "qmd-snippet", text: r.snippet });
    row.onclick = (): void => { void openTarget(app, client, r); };
  }
}

async function openTarget(app: App, client: QmdClient, r: QmdSearchResult): Promise<void> {
  const target = resolveOpenTarget(r.file, r.docid, (p) => isVaultFile(app, p));
  if (target.kind === "vault") {
    await app.workspace.openLinkText(target.path, "", false);
  } else {
    const { DocPreviewModal } = await import("./views/doc-preview");
    new DocPreviewModal(app, client, target.docid).open();
  }
}
