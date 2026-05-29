import { App, Modal, Setting } from "obsidian";

export interface BootstrapInput { url: string; branch: string }

export class GitBootstrapModal extends Modal {
  private input: BootstrapInput = { url: "", branch: "main" };
  private submitted = false;
  constructor(app: App, private onSubmit: (input: BootstrapInput | null) => void) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle("Bootstrap vault from remote");
    contentEl.createEl("p", { text: "Initialises this empty vault as a git repo and resets to the remote branch. Aborts if the vault is not empty." });

    new Setting(contentEl).setName("Remote URL")
      .addText((t) => t.setPlaceholder("https://github.com/you/notes.git").onChange((v) => { this.input.url = v.trim(); }));
    new Setting(contentEl).setName("Branch")
      .addText((t) => t.setValue(this.input.branch).onChange((v) => { this.input.branch = v.trim() || "main"; }));
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Bootstrap").setCta().onClick(() => {
        this.submitted = true;
        this.close();
      }));
  }

  onClose(): void {
    this.contentEl.empty();
    this.onSubmit(this.submitted ? { ...this.input } : null);
  }
}
