import { App, Modal, MarkdownRenderer, Notice, Component } from "obsidian";
import type { QmdClient } from "../qmd-client";

/** Read-only preview of an external (non-vault) document fetched by docid via MCP get. */
export class DocPreviewModal extends Modal {
  private renderComponent = new Component();
  constructor(app: App, private client: QmdClient, private docid: string) { super(app); }

  async onOpen(): Promise<void> {
    this.renderComponent.load();
    this.titleEl.setText("Loading…");
    const body = this.contentEl.createDiv({ cls: "qmd-doc-preview markdown-rendered" });
    try {
      const doc = await this.client.mcpGet(this.docid);
      this.titleEl.setText(doc.title);
      await MarkdownRenderer.render(this.app, doc.text, body, doc.path, this.renderComponent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`Preview failed: ${msg}`);
      this.close();
    }
  }
  onClose(): void { this.renderComponent.unload(); this.contentEl.empty(); }
}
