import { App, SuggestModal } from "obsidian";
import type { QmdClient, QmdSearchResult } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { planModalSearch } from "../modal-query";
import { decideFallback } from "../search-fallback";
import { resolveOpenTarget } from "../open-target";
import { makeVaultResolver } from "../vault-resolver";
import { cleanSnippet } from "../clean-snippet";
import { openResolvedTarget } from "../open-action";

/** Keyboard-driven palette search. Queries qmd as-you-type (debounced, stale-guarded) and opens the chosen result like the side panel. */
export class QmdSearchModal extends SuggestModal<QmdSearchResult> {
  private searchId = 0;
  private debounceTimer: number | null = null;
  private pendingResolve: ((results: QmdSearchResult[]) => void) | null = null;
  // Built once per (ephemeral) modal instance, not per suggestion row.
  private readonly resolveVaultPath: ReturnType<typeof makeVaultResolver>;

  constructor(app: App, private client: QmdClient, private settings: QmdSettings) {
    super(app);
    this.resolveVaultPath = makeVaultResolver(app);
    this.setPlaceholder("Search qmd — vault + collections…");
    this.emptyStateText = "No results.";
  }

  getSuggestions(query: string): Promise<QmdSearchResult[]> {
    // Supersede any pending debounce: clear its timer and resolve its promise empty so nothing dangles.
    if (this.debounceTimer !== null) { window.clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    if (this.pendingResolve) { this.pendingResolve([]); this.pendingResolve = null; }
    if (query.trim() === "") return Promise.resolve([]);

    return new Promise<QmdSearchResult[]>((resolve) => {
      this.pendingResolve = resolve;
      this.debounceTimer = window.setTimeout(() => {
        this.debounceTimer = null;
        this.pendingResolve = null;
        void this.run(query, resolve);
      }, this.settings.searchDebounceMs);
    });
  }

  private async run(query: string, resolve: (results: QmdSearchResult[]) => void): Promise<void> {
    const id = ++this.searchId;
    const mode = this.settings.searchMode;
    const plan = planModalSearch(mode, query, this.settings);
    if (plan.kind !== "run") { resolve([]); return; }
    try {
      const results = await this.client.query({ searches: plan.searches, collections: plan.collections, rerank: plan.rerank });
      if (id !== this.searchId) { resolve([]); return; } // superseded
      if (mode === "hybrid" && decideFallback({ errored: false, resultCount: results.length }, this.settings).fallback) {
        // runFallback re-checks searchId internally and yields [] if superseded.
        resolve(await this.runFallback(query, plan.collections, id));
        return;
      }
      this.emptyStateText = "No results.";
      resolve(results);
    } catch (e) {
      if (id !== this.searchId) { resolve([]); return; }
      if (mode === "hybrid" && decideFallback({ errored: true, resultCount: 0 }, this.settings).fallback) {
        resolve(await this.runFallback(query, plan.collections, id));
        return;
      }
      this.emptyStateText = `Error: ${e instanceof Error ? e.message : String(e)}`;
      resolve([]);
    }
  }

  private async runFallback(query: string, collections: string[], id: number): Promise<QmdSearchResult[]> {
    try {
      const results = await this.client.query({ searches: [{ type: "lex", query }], collections, rerank: false });
      if (id !== this.searchId) return [];
      this.emptyStateText = "No results.";
      return results;
    } catch (e) {
      if (id !== this.searchId) return [];
      this.emptyStateText = `Error: ${e instanceof Error ? e.message : String(e)}`;
      return [];
    }
  }

  renderSuggestion(result: QmdSearchResult, el: HTMLElement): void {
    const target = resolveOpenTarget(result.file, result.docid, this.resolveVaultPath, this.settings.vaultCollectionName);
    el.createDiv({ cls: "qmd-result-title", text: result.title || result.file });
    const meta = el.createDiv({ cls: "qmd-result-meta" });
    meta.createSpan({ cls: `qmd-badge ${target.kind}`, text: target.kind === "vault" ? "vault" : "external" });
    el.createDiv({ cls: "qmd-snippet", text: cleanSnippet(result.snippet) });
  }

  onChooseSuggestion(result: QmdSearchResult): void {
    const target = resolveOpenTarget(result.file, result.docid, this.resolveVaultPath, this.settings.vaultCollectionName);
    void openResolvedTarget(this.app, this.client, target);
  }
}
