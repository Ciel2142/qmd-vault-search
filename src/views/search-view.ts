import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { QmdClient, QmdSearchResult } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { resolveOpenTarget } from "../open-target";

export const VIEW_TYPE_QMD_SEARCH = "qmd-search-view";

export class SearchView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private client: QmdClient,
    private settings: QmdSettings,
  ) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_QMD_SEARCH; }
  getDisplayText(): string { return "qmd Search"; }
  getIcon(): string { return "search"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("qmd-search-view");

    const input = root.createEl("input", { type: "text", placeholder: "Search vault + collections…" });
    input.addClass("qmd-search-input");

    const chips = root.createDiv({ cls: "qmd-chips" });
    const selected = new Set<string>([this.settings.vaultCollectionName]);
    const renderChips = () => {
      chips.empty();
      const all = [this.settings.vaultCollectionName, ...this.settings.externalCollections];
      for (const name of all) {
        const chip = chips.createSpan({ cls: "qmd-chip", text: name });
        if (selected.has(name)) chip.addClass("is-active");
        if (name === this.settings.vaultCollectionName) { chip.addClass("is-locked"); }
        else chip.onclick = () => { selected.has(name) ? selected.delete(name) : selected.add(name); renderChips(); };
      }
    };
    renderChips();

    const list = root.createDiv({ cls: "qmd-results" });

    const runSearch = async () => {
      const q = input.value.trim();
      if (!q) return;
      list.empty();
      list.createDiv({ cls: "qmd-status", text: "Searching…" });
      try {
        const results = await this.client.query({
          searches: [{ type: "lex", query: q }, { type: "vec", query: q }],
          collections: [...selected],
          rerank: this.settings.rerank,
        });
        this.renderResults(list, results);
      } catch (e) {
        list.empty();
        const msg = e instanceof Error ? e.message : String(e);
        list.createDiv({ cls: "qmd-status", text: `Error: ${msg}` });
      }
    };
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void runSearch(); });
  }

  private renderResults(list: HTMLElement, results: QmdSearchResult[]): void {
    list.empty();
    if (results.length === 0) { list.createDiv({ cls: "qmd-status", text: "No results." }); return; }
    for (const r of results) {
      const row = list.createDiv({ cls: "qmd-result" });
      const target = resolveOpenTarget(r.file, r.docid, (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile);
      row.createDiv({ cls: "qmd-result-title", text: r.title || r.file });
      const meta = row.createDiv({ cls: "qmd-result-meta" });
      meta.createSpan({ cls: `qmd-badge ${target.kind}`, text: target.kind === "vault" ? "vault" : "external" });
      meta.createSpan({ cls: "qmd-score", text: `${Math.round(r.score * 100)}%` });
      const graphBtn = meta.createSpan({ cls: "qmd-graph-link", text: "graph" });
      graphBtn.onclick = (ev) => {
        ev.stopPropagation();
        // Center the graph on this hit (vault note path, or external file path).
        this.app.workspace.trigger("qmd:center-graph", r.file, r.title || r.file);
      };
      row.createDiv({ cls: "qmd-snippet", text: r.snippet });
      row.onclick = () => this.openTarget(r);
    }
  }

  private async openTarget(r: QmdSearchResult): Promise<void> {
    const target = resolveOpenTarget(r.file, r.docid, (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile);
    if (target.kind === "vault") {
      await this.app.workspace.openLinkText(target.path, "", false);
    } else {
      const { DocPreviewModal } = await import("../views/doc-preview");
      new DocPreviewModal(this.app, this.client, target.docid).open();
    }
  }

  async onClose(): Promise<void> { this.contentEl.empty(); }
}
