import { Plugin, Notice, FileSystemAdapter, WorkspaceLeaf, requestUrl } from "obsidian";
import { DEFAULT_SETTINGS, QmdSettings, baseUrl } from "./settings";
import { QmdSettingTab } from "./settings-tab";
import { QmdClient } from "./qmd-client";
import { makeRequestUrlFetch } from "./request-url-fetch";
import { DaemonController, SpawnFn } from "./daemon-controller";
import { Indexer } from "./indexer";
import { makeRunQmd } from "./cli";
import { SearchView, VIEW_TYPE_QMD_SEARCH } from "./views/search-view";
import { RelatedNotesView, VIEW_TYPE_QMD_RELATED } from "./views/related-notes-view";
import { QmdSearchModal } from "./views/search-modal";
import { QmdLinkSuggest } from "./views/link-suggest-view";
import { spawn } from "node:child_process";
import { platformSpawnOptions } from "./spawn-opts";

export default class QmdPlugin extends Plugin {
  settings!: QmdSettings;
  client!: QmdClient;
  daemon!: DaemonController;
  indexer!: Indexer;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.client = new QmdClient({ baseUrl: baseUrl(this.settings), fetchFn: makeRequestUrlFetch(requestUrl) });

    const spawnFn: SpawnFn = (cmd, args, opts) => {
      const child = spawn(cmd, args, platformSpawnOptions(opts) as object);
      child.on("error", (e) => new Notice(`qmd daemon failed to start: ${e.message}. Check the qmd binary path in settings.`));
      return child;
    };
    this.daemon = new DaemonController({ client: this.client, spawnFn, binaryPath: this.settings.binaryPath, port: this.settings.daemonPort });

    const vaultPath = this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : "";
    this.indexer = new Indexer({ runQmd: makeRunQmd(this.settings.binaryPath), vaultPath, collectionName: this.settings.vaultCollectionName, mask: this.settings.mask, debounceMs: this.settings.debounceMs });

    this.registerView(VIEW_TYPE_QMD_SEARCH, (leaf: WorkspaceLeaf) => new SearchView(leaf, this.client, this.settings, () => this.saveSettings()));
    this.addRibbonIcon("search", "qmd Search", () => this.activateSearchView());
    this.addCommand({ id: "open-qmd-search", name: "Open qmd search panel", callback: () => this.activateSearchView() });
    this.addCommand({ id: "open-qmd-search-modal", name: "Search qmd (modal)", callback: () => new QmdSearchModal(this.app, this.client, this.settings).open() });
    // Semantic @@ link suggester (non-[[ trigger: the built-in [[ suggester claims any [[... context).
    // Passes current client/settings, same as the search surfaces;
    // the daemon URL is only re-read on a settings change after a reload (matches the views' behavior).
    this.registerEditorSuggest(new QmdLinkSuggest(this.app, this.client, this.settings));
    this.registerView(VIEW_TYPE_QMD_RELATED, (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this.client, this.settings));
    this.addRibbonIcon("list", "qmd Related notes", () => this.activateRelatedView());
    this.addCommand({ id: "open-qmd-related", name: "Open related notes panel", callback: () => this.activateRelatedView() });
    this.addSettingTab(new QmdSettingTab(this.app, this));

    // Daemon: probe, offer to start.
    const status = await this.daemon.ensureRunning();
    if (status === "started") new Notice("qmd daemon not running — starting it. Give it a few seconds to load models.");

    // Vault freshness: register on first run, reindex on save.
    if (this.settings.autoReindex && vaultPath) {
      void this.bootstrapIndexing();
      this.registerEvent(this.app.vault.on("modify", () => this.indexer.notifyChange()));
      this.registerEvent(this.app.vault.on("create", () => this.indexer.notifyChange()));
      this.registerEvent(this.app.vault.on("delete", () => this.indexer.notifyChange()));
      this.registerEvent(this.app.vault.on("rename", () => this.indexer.notifyChange()));
    }
  }

  private async bootstrapIndexing(): Promise<void> {
    try {
      const cols = await this.client.mcpStatus().then((c) => c.map((x) => x.name)).catch(() => [] as string[]);
      await this.indexer.ensureCollection(cols);
    } catch (e) {
      console.warn("qmd-search: vault collection bootstrap:", e);
    }
  }

  private async activateSearchView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_QMD_SEARCH)[0];
    if (!leaf) { leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true); await leaf.setViewState({ type: VIEW_TYPE_QMD_SEARCH, active: true }); }
    await workspace.revealLeaf(leaf);
  }

  private async activateRelatedView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_QMD_RELATED)[0];
    if (!leaf) { leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true); await leaf.setViewState({ type: VIEW_TYPE_QMD_RELATED, active: true }); }
    await workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.client = new QmdClient({ baseUrl: baseUrl(this.settings), fetchFn: makeRequestUrlFetch(requestUrl) });
  }
  async onunload(): Promise<void> { this.indexer?.dispose(); }
}
