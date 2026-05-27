import { App, Modal, Notice, Setting, TAbstractFile, TFolder } from "obsidian";
import type { RunQmd } from "../indexer";
import { vaultVirtualPath, readContext, setContext, removeContext } from "../qmd-context";

export interface ContextModalDeps {
  app: App;
  runQmd: RunQmd;
  collection: string;
  file: TAbstractFile;
}

/** Modal to set/edit/remove a qmd context summary for a vault file or folder. */
export class ContextModal extends Modal {
  private readonly deps: ContextModalDeps;
  private readonly isRoot: boolean;
  private readonly virtualPath: string;
  private closed = false;

  constructor(deps: ContextModalDeps) {
    super(deps.app);
    this.deps = deps;
    this.isRoot = deps.file instanceof TFolder && deps.file.isRoot();
    this.virtualPath = vaultVirtualPath(deps.collection, deps.file.path, this.isRoot);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle("Set qmd context");
    contentEl.createEl("div", { text: this.virtualPath, cls: "qmd-context-path" });

    const textarea = contentEl.createEl("textarea", { cls: "qmd-context-textarea" });
    textarea.rows = 5;
    textarea.placeholder = "Loading current context…";
    textarea.disabled = true;
    textarea.setAttribute("aria-label", "qmd context summary");

    let removeBtn: HTMLButtonElement | null = null;
    let saveBtn: HTMLButtonElement | null = null;
    new Setting(contentEl)
      .addButton((b) => {
        removeBtn = b.setButtonText("Remove").buttonEl;
        b.onClick(() => void this.runAndClose(() => removeContext(this.deps.runQmd, this.virtualPath), removeBtn, saveBtn, "removed"));
        removeBtn.hide();
      })
      .addButton((b) => {
        saveBtn = b.setButtonText("Save").setCta().buttonEl;
        b.setDisabled(true);
        b.onClick(() => void this.runAndClose(() => setContext(this.deps.runQmd, this.virtualPath, textarea.value.trim()), removeBtn, saveBtn, "saved"));
      });

    textarea.addEventListener("input", () => { if (saveBtn) saveBtn.disabled = textarea.value.trim() === ""; });

    void readContext(this.deps.runQmd, this.deps.collection, this.deps.file.path, this.isRoot)
      .then((cur) => {
        if (this.closed) return;
        textarea.disabled = false;
        textarea.placeholder = "Describe what this file/folder contains…";
        if (cur !== null) {
          textarea.value = cur;
          removeBtn?.show();
          if (saveBtn) saveBtn.disabled = cur.trim() === "";
        }
      })
      .catch(() => {
        if (this.closed) return;
        textarea.disabled = false;
        textarea.placeholder = "Could not load current context.";
        new Notice("qmd context: failed to read current context");
      });
  }

  private async runAndClose(
    op: () => Promise<{ ok: boolean; error?: string }>,
    removeBtn: HTMLButtonElement | null,
    saveBtn: HTMLButtonElement | null,
    verb: string,
  ): Promise<void> {
    if (removeBtn) removeBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    const res = await op();
    new Notice(res.ok ? `qmd context ${verb}` : `qmd context: ${res.error}`);
    this.close();
  }

  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }
}
