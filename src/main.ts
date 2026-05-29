import { Plugin, Notice, FileSystemAdapter, WorkspaceLeaf, requestUrl, TAbstractFile } from "obsidian";
import { DEFAULT_SETTINGS, QmdSettings, baseUrl, resolveVaultCollectionName } from "./settings";
import { QmdSettingTab } from "./settings-tab";
import { QmdClient } from "./qmd-client";
import { makeRequestUrlFetch } from "./request-url-fetch";
import { DaemonController, SpawnFn } from "./daemon-controller";
import { Indexer, type RunQmd } from "./indexer";
import { makeRunQmd } from "./cli";
import { SearchView, VIEW_TYPE_QMD_SEARCH } from "./views/search-view";
import { RelatedNotesView, VIEW_TYPE_QMD_RELATED } from "./views/related-notes-view";
import { QmdSearchModal } from "./views/search-modal";
import { QmdLinkSuggest } from "./views/link-suggest-view";
import { ContextModal } from "./views/context-modal";
import { DaemonStatusBar } from "./views/daemon-status-bar";
import { spawn } from "node:child_process";
import { platformSpawnOptions } from "./spawn-opts";

export default class QmdPlugin extends Plugin {
  settings!: QmdSettings;
  client!: QmdClient;
  daemon!: DaemonController;
  indexer!: Indexer;
  runQmd!: RunQmd;
  statusBar!: DaemonStatusBar;

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
    // qmd CLI runner shared by the indexer + the context menu/command. Captures
    // binaryPath at load time (refreshed only on plugin reload) — same posture as DaemonController/Indexer.
    this.runQmd = makeRunQmd(this.settings.binaryPath);
    this.indexer = new Indexer({ runQmd: this.runQmd, vaultPath, collectionName: this.settings.vaultCollectionName, mask: this.settings.mask, debounceMs: this.settings.debounceMs });

    this.registerView(VIEW_TYPE_QMD_SEARCH, (leaf: WorkspaceLeaf) => new SearchView(leaf, this.client, this.settings, () => this.saveSettings()));
    this.addRibbonIcon("search", "qmd Vault Search", () => this.activateSearchView());
    this.addCommand({ id: "open-qmd-search", name: "Open qmd Vault Search panel", callback: () => this.activateSearchView() });
    this.addCommand({ id: "open-qmd-search-modal", name: "Search qmd (modal)", callback: () => new QmdSearchModal(this.app, this.client, this.settings).open() });
    // Semantic @@ link suggester (non-[[ trigger: the built-in [[ suggester claims any [[... context).
    // Passes current client/settings, same as the search surfaces;
    // the daemon URL is only re-read on a settings change after a reload (matches the views' behavior).
    this.registerEditorSuggest(new QmdLinkSuggest(this.app, this.client, this.settings));
    this.registerView(VIEW_TYPE_QMD_RELATED, (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this.client, this.settings));
    this.addRibbonIcon("list", "qmd Related notes", () => this.activateRelatedView());
    this.addCommand({ id: "open-qmd-related", name: "Open related notes panel", callback: () => this.activateRelatedView() });
    this.addSettingTab(new QmdSettingTab(this.app, this));

    // Right-click a file/folder → set its qmd context summary.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        menu.addItem((item) =>
          item
            .setTitle("Set qmd context…")
            .setIcon("text-cursor-input")
            .onClick(() => this.openContextModal(file)),
        );
      }),
    );
    this.addCommand({
      id: "set-qmd-context",
      name: "Set qmd context for current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.openContextModal(file);
        return true;
      },
    });

    // Daemon: probe, offer to start.
    const status = await this.daemon.ensureRunning();
    if (status === "started") new Notice("qmd daemon not running — starting it. Give it a few seconds to load models.");

    // Status-bar indicator + manual start. Polls health so it also tracks the daemon dying mid-session.
    this.statusBar = new DaemonStatusBar({
      el: this.addStatusBarItem(),
      port: this.settings.daemonPort,
      health: () => this.client.health(),
      start: () => this.daemon.start(),
      notify: (m) => new Notice(m),
    });
    void this.statusBar.refresh();
    this.registerInterval(window.setInterval(() => void this.statusBar.refresh(), 10_000));
    this.addCommand({ id: "start-qmd-daemon", name: "Start qmd daemon", callback: () => void this.statusBar.startDaemon() });

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
      console.warn("qmd-vault-search: vault collection bootstrap:", e);
    }
  }

  private openContextModal(file: TAbstractFile): void {
    new ContextModal({ app: this.app, runQmd: this.runQmd, collection: this.settings.vaultCollectionName, file }).open();
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

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<QmdSettings> | null;
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    const vaultCollectionName = resolveVaultCollectionName({
      savedName: merged.vaultCollectionName,
      hadSavedData: saved != null,
      vaultName: this.app.vault.getName(),
    });
    this.settings = { ...merged, vaultCollectionName };
    if (vaultCollectionName !== merged.vaultCollectionName) await this.saveData(this.settings);
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.client = new QmdClient({ baseUrl: baseUrl(this.settings), fetchFn: makeRequestUrlFetch(requestUrl) });
  }
  async onunload(): Promise<void> { this.indexer?.dispose(); }
}
