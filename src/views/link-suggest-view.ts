import { App, EditorSuggest, TFile } from "obsidian";
import type { Editor, EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo } from "obsidian";
import type { QmdClient, QmdSearchResult, QmdSubQuery } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { parseLinkTrigger, planLinkQuery } from "../link-suggest";
import { makeVaultResolver } from "../vault-resolver";
import { resolveOpenTarget } from "../open-target";
import { cleanSnippet } from "../clean-snippet";

/** A qmd vault-collection hit plus the real vault TFile it resolved to. */
export interface LinkSuggestion {
  result: QmdSearchResult;
  file: TFile;
}

/**
 * Semantic `@@` link suggester. Typing `@@<text>` opens a vec-only suggester
 * over the vault collection; choosing a hit inserts a normal `[[wikilink]]`.
 * Uses `@@` (not `[[`) because Obsidian's built-in `[[` suggester claims any
 * `[[...` context, so a custom suggester there never shows (confirmed by smoke);
 * `@@` leaves the built-in untouched and lets this popup win.
 * Long-lived (registered once); mirrors the search modal's debounce + searchId stale-guard.
 */
export class QmdLinkSuggest extends EditorSuggest<LinkSuggestion> {
  private searchId = 0;
  private debounceTimer: number | null = null;
  private pendingResolve: ((results: LinkSuggestion[]) => void) | null = null;

  constructor(app: App, private client: QmdClient, private settings: QmdSettings) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const t = parseLinkTrigger(before);
    if (!t) return null;
    return { start: { line: cursor.line, ch: t.startCh }, end: cursor, query: t.query };
  }

  getSuggestions(context: EditorSuggestContext): Promise<LinkSuggestion[]> {
    // Supersede any pending debounce: clear its timer and resolve its promise empty so nothing dangles.
    if (this.debounceTimer !== null) { window.clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    if (this.pendingResolve) { this.pendingResolve([]); this.pendingResolve = null; }
    const plan = planLinkQuery(context.query, this.settings);
    if (plan.kind !== "run") return Promise.resolve([]);
    const { searches, collections, rerank } = plan;
    return new Promise<LinkSuggestion[]>((resolve) => {
      this.pendingResolve = resolve;
      this.debounceTimer = window.setTimeout(() => {
        this.debounceTimer = null;
        this.pendingResolve = null;
        void this.run(searches, collections, rerank, resolve);
      }, this.settings.searchDebounceMs);
    });
  }

  private async run(searches: QmdSubQuery[], collections: string[], rerank: boolean, resolve: (results: LinkSuggestion[]) => void): Promise<void> {
    const id = ++this.searchId;
    // Fresh resolver per settled query: the suggester is long-lived and the vault mutates while editing.
    const resolveVaultPath = makeVaultResolver(this.app);
    try {
      const results = await this.client.query({ searches, collections, rerank });
      if (id !== this.searchId) { resolve([]); return; } // superseded
      const out: LinkSuggestion[] = [];
      for (const result of results) {
        // qmd prefixes paths with the collection name (`vault/...`) and slugs spaces to hyphens;
        // resolveOpenTarget strips the prefix + reverses the slug. External-collection hits aren't [[-linkable.
        const target = resolveOpenTarget(result.file, result.docid, resolveVaultPath, this.settings.vaultCollectionName);
        if (target.kind !== "vault") continue;
        const file = this.app.vault.getAbstractFileByPath(target.path);
        if (file instanceof TFile) out.push({ result, file });
      }
      resolve(out);
    } catch {
      // Superseded, daemon down, or query error → no popup, no crash.
      resolve([]);
    }
  }

  renderSuggestion(s: LinkSuggestion, el: HTMLElement): void {
    el.createDiv({ cls: "qmd-result-title", text: s.result.title || s.file.basename });
    el.createDiv({ cls: "qmd-snippet", text: cleanSnippet(s.result.snippet) });
  }

  selectSuggestion(s: LinkSuggestion, _evt: MouseEvent | KeyboardEvent): void {
    const ctx = this.context;
    if (!ctx) return;
    const link = this.app.fileManager.generateMarkdownLink(s.file, ctx.file?.path ?? "");
    ctx.editor.replaceRange(link, ctx.start, ctx.end);
  }
}
