import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { QmdClient } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { deriveNeighbors } from "../neighbors";
import { renderResultList } from "../result-list";
import { shouldRefresh } from "../related-refresh";

export const VIEW_TYPE_QMD_RELATED = "qmd-related-notes";

const DEBOUNCE_MS = 300;

export class RelatedNotesView extends ItemView {
  private listEl!: HTMLElement;
  private lastPath: string | null = null;
  private visible = true;
  private renderToken = 0;
  private debounceTimer: number | null = null;
  private observer: IntersectionObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private client: QmdClient, private settings: QmdSettings) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_QMD_RELATED; }
  getDisplayText(): string { return "Related notes"; }
  getIcon(): string { return "list"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("qmd-related-view");
    this.listEl = this.contentEl.createDiv({ cls: "qmd-results" });

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));

    this.observer?.disconnect();   // guard against a repeated onOpen on the same instance
    this.visible = true;
    this.observer = new IntersectionObserver((entries) => {
      const wasVisible = this.visible;
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible && !wasVisible) this.scheduleRefresh();
    });
    this.observer.observe(this.contentEl);

    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => { this.debounceTimer = null; void this.refresh(); }, DEBOUNCE_MS);
  }

  private async refresh(): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    const info = active ? { path: active.path, extension: active.extension } : null;
    const decision = shouldRefresh(info, this.lastPath, this.visible);

    if (decision.action === "skip" || decision.action === "defer") return;
    if (decision.action === "clear") {
      this.lastPath = null;
      renderResultList({ container: this.listEl, results: [], app: this.app, client: this.client, emptyText: "Open a note to see related notes.", vaultCollectionName: this.settings.vaultCollectionName });
      return;
    }

    // decision.action === "render"
    const path = decision.path;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    const token = ++this.renderToken;
    this.listEl.empty();
    this.listEl.createDiv({ cls: "qmd-status", text: "Finding related notes…" });
    try {
      const content = await this.app.vault.cachedRead(file);
      const neighbors = await deriveNeighbors(this.client, {
        content,
        collections: [this.settings.vaultCollectionName, ...this.settings.externalCollections],
        selfFile: `${this.settings.vaultCollectionName}/${path}`, // qmd reports collection-prefixed paths; match that form to filter the active note out
        limit: this.settings.relatedTopK,
        minScore: this.settings.relatedMinScore,
      });
      if (token !== this.renderToken) return; // superseded by a newer refresh
      renderResultList({ container: this.listEl, results: neighbors, app: this.app, client: this.client, emptyText: "No related notes found.", vaultCollectionName: this.settings.vaultCollectionName });
      this.lastPath = path;
    } catch (e) {
      if (token !== this.renderToken) return;
      console.error("qmd-related: failed to derive related notes:", e);
      this.listEl.empty();
      this.listEl.createDiv({ cls: "qmd-status", text: "qmd daemon not reachable — related notes unavailable." });
      // lastPath left unchanged → retry on the next note switch
    }
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.observer?.disconnect();
    this.observer = null;
    this.contentEl.empty();
  }
}
