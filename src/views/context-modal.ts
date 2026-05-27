import { App, ButtonComponent, Modal, Notice, Setting, TAbstractFile, TFolder } from "obsidian";
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

    let removeBtn: ButtonComponent | null = null;
    let saveBtn: ButtonComponent | null = null;
    new Setting(contentEl)
      .addButton((b) => {
        removeBtn = b.setButtonText("Remove");
        b.onClick(() => void this.runAndClose(() => removeContext(this.deps.runQmd, this.virtualPath), removeBtn, saveBtn, "removed"));
        b.buttonEl.hide();
      })
      .addButton((b) => {
        saveBtn = b.setButtonText("Save").setCta().setDisabled(true);
        b.onClick(() => void this.runAndClose(() => setContext(this.deps.runQmd, this.virtualPath, textarea.value.trim()), removeBtn, saveBtn, "saved"));
      });

    // Toggle via setDisabled (the ButtonComponent), not buttonEl.disabled: Obsidian's
    // click handler is gated on the component's `disabled` flag, so poking the raw DOM
    // property leaves the button looking active (CTA) while silently swallowing clicks.
    textarea.addEventListener("input", () => saveBtn?.setDisabled(textarea.value.trim() === ""));

    void readContext(this.deps.runQmd, this.deps.collection, this.deps.file.path, this.isRoot)
      .then((cur) => {
        if (this.closed) return;
        textarea.disabled = false;
        textarea.placeholder = "Describe what this file/folder contains…";
        if (cur !== null) {
          textarea.value = cur;
          removeBtn?.buttonEl.show();
          saveBtn?.setDisabled(cur.trim() === "");
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
    removeBtn: ButtonComponent | null,
    saveBtn: ButtonComponent | null,
    verb: string,
  ): Promise<void> {
    removeBtn?.setDisabled(true);
    saveBtn?.setDisabled(true);
    const res = await op();
    new Notice(res.ok ? `qmd context ${verb}` : `qmd context: ${res.error}`);
    this.close();
  }

  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }
}
