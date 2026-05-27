import { ItemView, WorkspaceLeaf } from "obsidian";
import type { QmdClient, QmdSearchResult } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { groupResults } from "../group-results";
import { renderGroupedResults } from "../grouped-result-list";
import { queryTerms } from "../highlight";
import { makeVaultResolver } from "../vault-resolver";
import { planQuery, type SearchMode, type SearchTrigger } from "../search-plan";
import { decideFallback } from "../search-fallback";

export const VIEW_TYPE_QMD_SEARCH = "qmd-search-view";

export class SearchView extends ItemView {
  private mode: SearchMode;
  private searchId = 0;
  private debounceTimer: number | null = null;
  private collapsed = new Set<string>();

  constructor(
    leaf: WorkspaceLeaf,
    private client: QmdClient,
    private settings: QmdSettings,
    private saveSettings: () => Promise<void>,
  ) {
    super(leaf);
    this.mode = settings.searchMode;
  }

  getViewType(): string { return VIEW_TYPE_QMD_SEARCH; }
  getDisplayText(): string { return "qmd Search"; }
  getIcon(): string { return "search"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("qmd-search-view");

    // Mode toggle ─────────────────────────────────────────────
    const toggle = root.createDiv({ cls: "qmd-mode-toggle" });
    const keywordBtn = toggle.createSpan({ cls: "qmd-mode-btn", text: "⚡ Keyword" });
    const hybridBtn = toggle.createSpan({ cls: "qmd-mode-btn", text: "🧠 Hybrid" });
    const renderToggle = (): void => {
      keywordBtn.toggleClass("is-active", this.mode === "keyword");
      hybridBtn.toggleClass("is-active", this.mode === "hybrid");
    };
    renderToggle();

    const input = root.createEl("input", { type: "text", placeholder: "Search vault + collections…" });
    input.addClass("qmd-search-input");

    // Collection chips (unchanged) ────────────────────────────
    const chips = root.createDiv({ cls: "qmd-chips" });
    const selected = new Set<string>([this.settings.vaultCollectionName]);
    const renderChips = (): void => {
      chips.empty();
      const all = [this.settings.vaultCollectionName, ...this.settings.externalCollections];
      for (const name of all) {
        const chip = chips.createSpan({ cls: "qmd-chip", text: name });
        if (selected.has(name)) chip.addClass("is-active");
        if (name === this.settings.vaultCollectionName) { chip.addClass("is-locked"); }
        else chip.onclick = (): void => { selected.has(name) ? selected.delete(name) : selected.add(name); renderChips(); };
      }
    };
    renderChips();

    const indicator = root.createDiv({ cls: "qmd-fallback-indicator" });
    indicator.hide();
    const list = root.createDiv({ cls: "qmd-results" });

    const showIndicator = (text: string): void => { indicator.setText(text); indicator.show(); };
    const clearIndicator = (): void => { indicator.empty(); indicator.hide(); };
    const render = (results: QmdSearchResult[], terms?: string[]): void => {
      const groups = groupResults(results, makeVaultResolver(this.app), this.settings.vaultCollectionName);
      const hl = terms ?? (this.mode === "keyword" ? queryTerms(input.value) : []);
      renderGroupedResults({
        container: list,
        groups,
        terms: hl,
        app: this.app,
        client: this.client,
        collapsed: this.collapsed,
        emptyText: "No results.",
        viewType: VIEW_TYPE_QMD_SEARCH,
        hoverParent: this,
        sourcePath: this.app.workspace.getActiveFile()?.path ?? "",
      });
    };
    const renderError = (e: unknown): void => {
      list.empty();
      list.createDiv({ cls: "qmd-status", text: `Error: ${e instanceof Error ? e.message : String(e)}` });
    };

    // Keyword fallback re-run for the hybrid path ─────────────
    const runFallback = async (id: number, reason: "zero" | "failure"): Promise<void> => {
      try {
        const results = await this.client.query({ searches: [{ type: "lex", query: input.value }], collections: [...selected], rerank: false });
        if (id !== this.searchId) return;
        showIndicator(reason === "zero" ? "Keyword results — semantic search returned nothing." : "Keyword results — semantic search failed.");
        render(results, queryTerms(input.value));
      } catch (e) {
        if (id !== this.searchId) return;
        clearIndicator();
        renderError(e);
      }
    };

    // Single entry point for both triggers ────────────────────
    const execute = async (trigger: SearchTrigger): Promise<void> => {
      const mode = this.mode; // snapshot: a mid-flight mode switch must not change this run's fallback behavior
      const plan = planQuery(trigger, mode, input.value);
      if (plan.kind === "none") return;
      if (plan.kind === "clear") { clearIndicator(); list.empty(); return; }

      const id = ++this.searchId;
      this.collapsed.clear();
      clearIndicator();
      list.empty();
      list.createDiv({ cls: "qmd-status", text: "Searching…" });
      const rerank = mode === "hybrid" ? this.settings.rerank : false;
      try {
        const results = await this.client.query({ searches: plan.searches, collections: [...selected], rerank });
        if (id !== this.searchId) return;
        if (mode === "hybrid") {
          const fb = decideFallback({ errored: false, resultCount: results.length }, this.settings);
          if (fb.fallback) { await runFallback(id, "zero"); return; }
        }
        render(results);
      } catch (e) {
        if (id !== this.searchId) return;
        if (mode === "hybrid") {
          const fb = decideFallback({ errored: true, resultCount: 0 }, this.settings);
          if (fb.fallback) { await runFallback(id, "failure"); return; }
        }
        renderError(e);
      }
    };

    const scheduleInput = (): void => {
      if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => { this.debounceTimer = null; void execute("input"); }, this.settings.searchDebounceMs);
    };

    const switchMode = async (next: SearchMode): Promise<void> => {
      if (this.mode === next) return;
      if (this.debounceTimer !== null) { window.clearTimeout(this.debounceTimer); this.debounceTimer = null; }
      this.mode = next;
      this.settings.searchMode = next;
      renderToggle();
      await this.saveSettings();
      if (next === "keyword") void execute("input"); // go live immediately if text present
    };

    input.addEventListener("input", () => scheduleInput());
    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      if (this.debounceTimer !== null) { window.clearTimeout(this.debounceTimer); this.debounceTimer = null; }
      void execute("enter");
    });
    keywordBtn.onclick = (): void => { void switchMode("keyword"); };
    hybridBtn.onclick = (): void => { void switchMode("hybrid"); };
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.contentEl.empty();
  }
}
