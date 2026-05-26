import { App } from "obsidian";
import type { QmdClient, QmdSearchResult } from "./qmd-client";
import { resolveOpenTarget } from "./open-target";
import { makeVaultResolver } from "./vault-resolver";
import { cleanSnippet } from "./clean-snippet";
import { openResolvedTarget } from "./open-action";

export interface RenderResultListOptions {
  container: HTMLElement;
  results: QmdSearchResult[];
  app: App;
  client: QmdClient;
  emptyText: string;
  vaultCollectionName: string;
}

/** Render a list of qmd results. Shared by SearchView and RelatedNotesView. */
export function renderResultList(opts: RenderResultListOptions): void {
  const { container, results, app, client, emptyText, vaultCollectionName } = opts;
  container.empty();
  if (results.length === 0) {
    container.createDiv({ cls: "qmd-status", text: emptyText });
    return;
  }
  const resolveVaultPath = makeVaultResolver(app);
  for (const [i, r] of results.entries()) {
    const row = container.createDiv({ cls: "qmd-result" });
    const target = resolveOpenTarget(r.file, r.docid, resolveVaultPath, vaultCollectionName);
    row.createDiv({ cls: "qmd-result-title", text: r.title || r.file });
    const meta = row.createDiv({ cls: "qmd-result-meta" });
    meta.createSpan({ cls: `qmd-badge ${target.kind}`, text: target.kind === "vault" ? "vault" : "external" });
    // Rank, not score: qmd's blended score is reciprocal-rank-dominated (1/rank), not calibrated relevance — show position instead.
    meta.createSpan({ cls: "qmd-rank", text: `#${i + 1}` });
    row.createDiv({ cls: "qmd-snippet", text: cleanSnippet(r.snippet) });
    row.onclick = (): void => { void openResolvedTarget(app, client, target); };
  }
}
