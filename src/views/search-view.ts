import { ItemView, WorkspaceLeaf } from "obsidian";
import type { QmdClient } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { renderResultList } from "../result-list";

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
        renderResultList({ container: list, results, app: this.app, client: this.client, emptyText: "No results." });
      } catch (e) {
        list.empty();
        const msg = e instanceof Error ? e.message : String(e);
        list.createDiv({ cls: "qmd-status", text: `Error: ${msg}` });
      }
    };
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void runSearch(); });
  }

  async onClose(): Promise<void> { this.contentEl.empty(); }
}
