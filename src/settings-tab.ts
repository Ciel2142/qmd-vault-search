import { App, PluginSettingTab, Setting } from "obsidian";
import type QmdPlugin from "./main";

export class QmdSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: QmdPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("qmd binary path").setDesc("Command or absolute path to the qmd CLI.")
      .addText((t) => t.setValue(this.plugin.settings.binaryPath).onChange(async (v) => { this.plugin.settings.binaryPath = v || "qmd"; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Daemon port").setDesc("Port of the qmd HTTP daemon.")
      .addText((t) => t.setValue(String(this.plugin.settings.daemonPort)).onChange(async (v) => { const n = parseInt(v, 10); if (!Number.isNaN(n)) { this.plugin.settings.daemonPort = n; await this.plugin.saveSettings(); } }));

    new Setting(containerEl).setName("Vault collection name").setDesc("qmd collection name for this vault.")
      .addText((t) => t.setValue(this.plugin.settings.vaultCollectionName).onChange(async (v) => { this.plugin.settings.vaultCollectionName = v || "vault"; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("External collections").setDesc("Comma-separated qmd collection names to include (Phase 2 replaces with a picker).")
      .addText((t) => t.setValue(this.plugin.settings.externalCollections.join(", ")).onChange(async (v) => { this.plugin.settings.externalCollections = v.split(",").map((s) => s.trim()).filter(Boolean); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Rerank").setDesc("LLM rerank on explicit search (slower, better quality).")
      .addToggle((t) => t.setValue(this.plugin.settings.rerank).onChange(async (v) => { this.plugin.settings.rerank = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Reindex on save").setDesc("Incrementally reindex the vault after edits.")
      .addToggle((t) => t.setValue(this.plugin.settings.autoReindex).onChange(async (v) => { this.plugin.settings.autoReindex = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Reindex debounce (ms)").setDesc("Idle delay before reindexing after edits.")
      .addText((t) => t.setValue(String(this.plugin.settings.debounceMs)).onChange(async (v) => { const n = parseInt(v, 10); if (!Number.isNaN(n)) { this.plugin.settings.debounceMs = n; await this.plugin.saveSettings(); } }));
  }
}
