import { ItemView, WorkspaceLeaf } from "obsidian";
import type { QmdClient, QmdSearchResult } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { groupResults } from "../group-results";
import { renderGroupedResults } from "../grouped-result-list";
import { queryTerms } from "../highlight";
import { makeVaultResolver } from "../vault-resolver";
import { planQuery, type SearchMode, type SearchTrigger } from "../search-plan";
import { decideFallback } from "../search-fallback";
import { tierFloor, tiersActive, tierLabel, tierEmptyText, TIERS, type ScoreTier } from "../score-tier";

export const VIEW_TYPE_QMD_SEARCH = "qmd-search-view";

export class SearchView extends ItemView {
  private mode: SearchMode;
  private minTier: ScoreTier;
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
    this.minTier = settings.searchMinTier;
  }

  getViewType(): string { return VIEW_TYPE_QMD_SEARCH; }
  getDisplayText(): string { return "qmd Vault Search"; }
  getIcon(): string { return "search"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("qmd-search-view");

    // Tiers (badge + min-score filter) are meaningful only for reranked hybrid scores (0-1).
    const tiersOn = (): boolean => tiersActive(this.mode, this.settings.rerank);

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

    // Collection chips ────────────────────────────────────────
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

    // Min-relevance tier filter (hybrid + rerank only) ────────
    const tierBar = root.createDiv({ cls: "qmd-tier-filter" });
    tierBar.createSpan({ cls: "qmd-tier-label", text: "Min relevance:" });
    const tierBtns = new Map<ScoreTier, HTMLElement>();
    for (const t of TIERS) {
      tierBtns.set(t, tierBar.createSpan({ cls: "qmd-mode-btn", text: tierLabel(t) }));
    }
    const renderTierBar = (): void => {
      if (tiersOn()) tierBar.show(); else tierBar.hide();
      for (const [t, btn] of tierBtns) btn.toggleClass("is-active", t === this.minTier);
    };

    const indicator = root.createDiv({ cls: "qmd-fallback-indicator" });
    indicator.hide();
    const list = root.createDiv({ cls: "qmd-results" });

    const showIndicator = (text: string): void => { indicator.setText(text); indicator.show(); };
    const clearIndicator = (): void => { indicator.empty(); indicator.hide(); };

    const emptyText = (): string =>
      (tiersOn() && tierFloor(this.minTier) > 0) ? tierEmptyText(this.minTier) : "No results.";

    const render = (
      results: QmdSearchResult[],
      resolveVaultPath: ReturnType<typeof makeVaultResolver>,
      terms?: string[],
      showTiers: boolean = tiersOn(),
    ): void => {
      const groups = groupResults(results, resolveVaultPath, this.settings.vaultCollectionName);
      const hl = terms ?? (this.mode === "keyword" ? queryTerms(input.value) : []);
      renderGroupedResults({
        container: list,
        groups,
        terms: hl,
        app: this.app,
        client: this.client,
        collapsed: this.collapsed,
        showTiers,
        emptyText: emptyText(),
        viewType: VIEW_TYPE_QMD_SEARCH,
        hoverParent: this,
        sourcePath: this.app.workspace.getActiveFile()?.path ?? "",
      });
    };
    const renderError = (e: unknown): void => {
      list.empty();
      list.createDiv({ cls: "qmd-status", text: `Error: ${e instanceof Error ? e.message : String(e)}` });
    };

    // Keyword fallback re-run for the hybrid path. Fallback hits are lex-scored,
    // so badges are off (showTiers = false). ──────────────────
    const runFallback = async (id: number, reason: "zero" | "failure", resolveVaultPath: ReturnType<typeof makeVaultResolver>): Promise<void> => {
      try {
        const results = await this.client.query({ searches: [{ type: "lex", query: input.value }], collections: [...selected], rerank: false });
        if (id !== this.searchId) return;
        showIndicator(reason === "zero" ? "Keyword results — semantic search returned nothing." : "Keyword results — semantic search failed.");
        render(results, resolveVaultPath, queryTerms(input.value), false);
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
      const minScore = tiersOn() ? tierFloor(this.minTier) : 0;
      const filtering = minScore > 0;
      // Build the vault slug-map once per search (bd 2fb).
      const resolveVaultPath = makeVaultResolver(this.app);
      try {
        const results = await this.client.query({ searches: plan.searches, collections: [...selected], rerank, minScore });
        if (id !== this.searchId) return;
        if (mode === "hybrid") {
          const fb = decideFallback({ errored: false, resultCount: results.length }, this.settings);
          // A zero count under an active filter is the filter working — show the tailored
          // empty state instead of falling back to unfiltered keyword results.
          if (fb.fallback && filtering) { render([], resolveVaultPath); return; }
          if (fb.fallback) { await runFallback(id, "zero", resolveVaultPath); return; }
        }
        render(results, resolveVaultPath);
      } catch (e) {
        if (id !== this.searchId) return;
        if (mode === "hybrid") {
          const fb = decideFallback({ errored: true, resultCount: 0 }, this.settings);
          if (fb.fallback) { await runFallback(id, "failure", resolveVaultPath); return; }
        }
        renderError(e);
      }
    };

    // Tier selection re-queries with the new floor. ───────────
    const selectTier = async (t: ScoreTier): Promise<void> => {
      if (this.minTier === t) return;
      this.minTier = t;
      this.settings.searchMinTier = t;
      renderTierBar();
      await this.saveSettings();
      void execute("enter");
    };
    for (const [t, btn] of tierBtns) btn.onclick = (): void => { void selectTier(t); };
    renderTierBar();

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
      renderTierBar();
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
